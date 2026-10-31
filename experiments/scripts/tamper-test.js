/**
 * Experiment 9 (DA-9): tamper-detection scenarios, CareChain vs the
 * centralised baseline. Three attacks by an insider with server access:
 *
 *   T1 corrupt   : flip one byte of a stored ciphertext blob
 *   T2 forge     : re-encrypt altered content under the record's own key and
 *                  replace the stored blob (needs key-store access)
 *   T3 audit     : edit / remove an audit-log entry
 *
 * For each we record what the system's normal read path does and whether an
 * independent check (sha256(blob) vs the ledger-anchored hash) can notice.
 * The baseline has no ledger: its "anchor" is a hash stored in the same
 * database, which the insider can rewrite.
 *
 * Requires CareChain backend (:4000), baseline (:4100), seeded chain.
 * Output: experiments/results/tamper-test.json
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const IMPL = path.join(__dirname, "..", "..", "implementation");
const { ethers } = require(path.join(IMPL, "node_modules", "ethers"));
const users = require(path.join(IMPL, "backend", "src", "chain", "users.json")).users;
const deployment = require(path.join(IMPL, "backend", "src", "chain", "deployment.json"));
const keystore = require(path.join(IMPL, "backend", "src", "services", "keystore"));
const storage = require(path.join(IMPL, "backend", "src", "services", "storage"));
const { decryptRecord, sha256Hex } = require(path.join(IMPL, "backend", "src", "services", "crypto"));
const { RESULTS_DIR } = require("./lib/csv");
const { connect, loadAbi } = require("./lib/chain");

const addr = (u) => users.find((x) => x.username === u).address;
const CC = process.env.CARECHAIN_URL || "http://localhost:4000";
const BL = "http://localhost:4100";
const ORIGINAL = "BP 118/76 mmHg | Dx: healthy | Plan: none";
const FORGED = "BP 118/76 mmHg | Dx: healthy | Plan: STOP ALL MEDICATION";

async function http(base, method, p, token, body, form) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !form) headers["Content-Type"] = "application/json";
  const res = await fetch(base + p, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  const buf = Buffer.from(await res.arrayBuffer());
  let data; try { data = JSON.parse(buf.toString("utf8")); } catch { data = buf.toString("utf8"); }
  return { status: res.status, data };
}
const login = async (b, u) => (await http(b, "POST", "/auth/login", null, { username: u, password: "password123" })).data.token;

async function setup(base) {
  const [patient, doctor] = await Promise.all([login(base, "patient1"), login(base, "doctor1")]);
  const form = new FormData();
  form.append("patientAddress", addr("patient1"));
  form.append("file", new Blob([Buffer.from(ORIGINAL)]), "r.txt");
  const up = await http(base, "POST", "/records/upload", doctor, null, form);
  const now = Math.floor(Date.now() / 1000);
  await http(base, "POST", "/consent/grant", patient, { providerAddress: addr("doctor1"), recordId: up.data.recordId, purpose: "treatment", validFrom: now - 5, validUntil: now + 86400 });
  return { doctor, patient, recordId: up.data.recordId, cid: up.data.cid, contentHash: up.data.contentHash };
}
const read = (base, s) => http(base, "GET", `/records/${s.recordId}/content?purpose=treatment`, s.doctor);
const text = (r) => (typeof r.data === "string" ? r.data : JSON.stringify(r.data)).slice(0, 90);

async function main() {
  const out = { run: new Date().toISOString(), carechain: {}, centralised: {} };
  const { contracts } = connect();

  // ---------------- CareChain ----------------
  const c = await setup(CC);
  const file = path.join(IMPL, "backend", "storage", c.cid.replace("local://", ""));
  const original = fs.readFileSync(file);
  const onchain = (await contracts.recordAnchor.getRecord(c.recordId)).contentHash.toLowerCase();

  const base = await read(CC, c);
  out.carechain.baselineRead = { status: base.status, body: text(base) };

  // T1: flip one byte
  const bad = Buffer.from(original); bad[40] ^= 0x01; fs.writeFileSync(file, bad);
  const t1 = await read(CC, c);
  out.carechain.T1_corrupt = { readStatus: t1.status, readBody: text(t1), independentHashCheckDetects: "0x" + sha256Hex(bad) !== onchain };
  fs.writeFileSync(file, original);

  // T2: forge under the record's own key
  const key = keystore.unwrap(c.recordId);
  const iv = crypto.randomBytes(12);
  const ciph = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([ciph.update(Buffer.from(FORGED)), ciph.final()]);
  const forged = Buffer.concat([iv, ciph.getAuthTag(), ct]);
  fs.writeFileSync(file, forged);
  const t2 = await read(CC, c);
  out.carechain.T2_forge = { readStatus: t2.status, readBody: text(t2), independentHashCheckDetects: "0x" + sha256Hex(forged) !== onchain };
  fs.writeFileSync(file, original);

  // T3: audit log has no mutator; unauthorised append reverts
  const abi = loadAbi("AuditLog");
  const mutators = abi.filter((x) => x.type === "function" && !["view", "pure"].includes(x.stateMutability)).map((x) => x.name);
  let appendFromAdmin = "accepted";
  try {
    const { wallet } = connect();
    await contracts.auditLog.connect(wallet(0)).append.staticCall(addr("patient1"), addr("admin"), ethers.ZeroHash, 0, "forged", false);
  } catch (e) { appendFromAdmin = "reverted: " + String(e.reason || e.shortMessage || e.message).slice(0, 80); }
  out.carechain.T3_audit = { stateChangingFunctionsOnAuditLog: mutators, appendByNonLogger: appendFromAdmin, editOrDeleteFunctionExists: mutators.some((n) => /edit|delete|update|remove|set/i.test(n)) };

  // ---------------- Centralised baseline ----------------
  const b = await setup(BL);
  const bBase = await read(BL, b);
  out.centralised.baselineRead = { status: bBase.status, body: text(bBase) };

  const store = (await http(BL, "GET", "/_admin/store")).data;
  const bf = store.records.find((r) => r.id === b.recordId).file;
  const bo = fs.readFileSync(bf);
  const bbad = Buffer.from(bo); bbad[40] ^= 0x01; fs.writeFileSync(bf, bbad);
  const bt1 = await read(BL, b);
  out.centralised.T1_corrupt = { readStatus: bt1.status, readBody: text(bt1) };
  fs.writeFileSync(bf, bo);

  const forge = await http(BL, "POST", "/_admin/forge", null, { recordId: b.recordId, text: FORGED });
  const bt2 = await read(BL, b);
  out.centralised.T2_forge = { readStatus: bt2.status, readBody: text(bt2), storedHashRewrittenToMatch: forge.data.forged === true, independentAnchor: "none (hash lives in the same database)" };

  const before = (await http(BL, "GET", "/_admin/audit")).data.audit;
  const idx = before.findIndex((e) => e.action === "ACCESS_GRANTED");
  const edit = await http(BL, "POST", "/_admin/audit/edit", null, { index: idx, patch: { action: "ACCESS_DENIED", actor: "0x0000000000000000000000000000000000000000" } });
  out.centralised.T3_audit = { editAccepted: edit.status === 200, entryAfterEdit: edit.data.edited && { action: edit.data.edited.action, actor: edit.data.edited.actor }, alarm: "none" };

  fs.writeFileSync(path.join(RESULTS_DIR, process.env.TAMPER_OUT || "tamper-test.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
