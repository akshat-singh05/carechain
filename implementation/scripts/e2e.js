/**
 * End-to-end smoke test of the REST API against a live local chain.
 * Prereqs: `npx hardhat node`, `npm run seed:local`, `npm run backend`.
 * Usage:   npm run e2e
 * Exits non-zero on the first failed assertion.
 */
const BASE = process.env.API_URL || "http://localhost:4000";
const users = require("../backend/src/chain/users.json").users;
const addr = (name) => users.find((u) => u.username === name).address;

let passed = 0;
function check(cond, label) {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`ok  - ${label}`);
}

async function call(method, path, token, body, isForm) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !isForm) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  const type = res.headers.get("content-type") || "";
  const data = type.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data };
}

async function login(username) {
  const r = await call("POST", "/auth/login", null, { username, password: "password123" });
  check(r.status === 200 && r.data.token, `login as ${username}`);
  return r.data.token;
}

(async () => {
  const bad = await call("POST", "/auth/login", null, { username: "patient1", password: "wrong" });
  check(bad.status === 401, "wrong password is rejected");

  const patient = await login("patient1");
  const doctor = await login("doctor1");
  const er = await login("erdoctor1");
  const auditor = await login("auditor1");

  // Start from a known state: revoke any consents left over from earlier runs/benchmarks
  // (a leftover wildcard consent would legitimately let doctor1 read the new record).
  const existing = await call("GET", "/consent/mine", patient);
  for (const c of existing.data.consents.filter((c) => !c.revoked)) {
    await call("POST", `/consent/${c.consentId}/revoke`, patient);
  }
  const stillActive = (await call("GET", "/consent/mine", patient)).data.consents.filter((c) => !c.revoked);
  check(stillActive.length === 0, "setup: patient1 has no active consents");

  // A non-address in an address field must give a clear 400, not a confusing ENS error
  const badAddr = await call("POST", "/consent/grant", patient, {
    providerAddress: "VIT Vellore",
    validUntil: Math.floor(Date.now() / 1000) + 3600,
  });
  check(badAddr.status === 400 && /start(ing)? with 0x/.test(badAddr.data.error), "invalid address gives a clear 400 error");
  const badParam = await call("GET", "/audit/not-an-address", auditor);
  check(badParam.status === 400, "invalid address in the URL gives 400");

  // 1. doctor uploads + anchors an encrypted record for patient1
  const plaintext = Buffer.from("CareChain e2e record: BP 120/80, " + Date.now());
  const form = new FormData();
  form.append("patientAddress", addr("patient1"));
  form.append("file", new Blob([plaintext]), "record.txt");
  const up = await call("POST", "/records/upload", doctor, form, true);
  check(up.status === 201 && up.data.recordId, "doctor uploads + anchors a record");
  const recordId = up.data.recordId;

  const upByPatient = await call("POST", "/records/upload", patient, form, true);
  check(upByPatient.status === 403, "patient cannot upload (provider-only)");

  const meta = await call("GET", `/records/${recordId}/meta`, doctor);
  check(meta.data.contentHash === up.data.contentHash, "on-chain hash matches upload response");

  // 2. no consent yet -> denied
  const noConsent = await call("GET", `/records/${recordId}/content?purpose=treatment`, doctor);
  if (noConsent.status !== 403) console.error("DEBUG noConsent:", noConsent.status, String(noConsent.data).slice(0,300));
  check(noConsent.status === 403, "doctor denied before any consent exists");

  // 3. patient grants time+purpose-bound consent
  const now = Math.floor(Date.now() / 1000);
  const grant = await call("POST", "/consent/grant", patient, {
    providerAddress: addr("doctor1"),
    recordId,
    purpose: "treatment",
    validFrom: now - 5,
    validUntil: now + 3600,
  });
  check(grant.status === 201, "patient grants consent (treatment, 1h)");

  // 4. correct purpose -> allowed + decrypts to the original bytes
  const ok = await call("GET", `/records/${recordId}/content?purpose=treatment`, doctor);
  check(ok.status === 200 && Buffer.compare(ok.data, plaintext) === 0, "doctor reads + decrypts with valid consent");

  // 5. wrong purpose -> denied
  const wrongPurpose = await call("GET", `/records/${recordId}/content?purpose=billing`, doctor);
  if (wrongPurpose.status !== 403) console.error("DEBUG wrongPurpose:", wrongPurpose.status, JSON.stringify(wrongPurpose.data).slice(0,400));
  check(wrongPurpose.status === 403, "wrong purpose (billing) is denied");

  const acc = await call("POST", "/access/request", doctor, {
    patientAddress: addr("patient1"),
    recordId,
    purpose: "treatment",
  });
  if (!(acc.status === 200 && acc.data.granted === true)) console.error("DEBUG access/request:", acc);
  check(acc.status === 200 && acc.data.granted === true, "access/request verifies consent");

  // 6. revoke -> denied again
  const mine = await call("GET", "/consent/mine", patient);
  const consentId = mine.data.consents[mine.data.consents.length - 1].consentId;
  const rev = await call("POST", `/consent/${consentId}/revoke`, patient);
  check(rev.status === 200, "patient revokes consent");
  const afterRevoke = await call("GET", `/records/${recordId}/content?purpose=treatment`, doctor);
  check(afterRevoke.status === 403, "doctor denied after revocation");

  // 7. break-glass: non-responder rejected, responder succeeds
  const eBad = await call("POST", "/emergency/access", doctor, {
    patientAddress: addr("patient1"),
    recordId,
    reason: "not an ER responder",
  });
  check(eBad.status === 500 && /emergency responder/i.test(eBad.data.error), "non-responder cannot break glass");

  const eOk = await call("POST", "/emergency/access", er, {
    patientAddress: addr("patient1"),
    recordId,
    reason: "unresponsive patient, ER intake",
  });
  check(eOk.status === 200 && eOk.data.notified === true, "responder breaks glass; notification confirmed on-chain");
  check(Buffer.from(eOk.data.recordContentBase64, "base64").equals(plaintext), "break-glass returns the decrypted record");

  const pend = await call("GET", `/emergency/pending/${addr("patient1")}`, patient);
  check(pend.status === 200 && pend.data.events.length >= 1, "patient can see the emergency event");

  // 7b. Merkle-batched upload: one anchorBatch tx for N records, proofs verifiable on-chain
  const { ethers } = require("ethers");
  const deployment = require("../backend/src/chain/deployment.json");
  const artifact = require("../artifacts/contracts/RecordAnchor.sol/RecordAnchor.json");
  const rpc = new ethers.JsonRpcProvider(process.env.RPC_URL || "http://127.0.0.1:8545");
  const anchor = new ethers.Contract(deployment.contracts.RecordAnchor, artifact.abi, rpc);
  const { leafFor } = require("./lib/merkle");

  const batchContents = [0, 1, 2].map((i) => Buffer.from(`batch record ${i} ${Date.now()}`));
  const bform = new FormData();
  bform.append("patientAddress", addr("patient1"));
  batchContents.forEach((c, i) => bform.append("files", new Blob([c]), `b${i}.txt`));
  const batch = await call("POST", "/records/upload-batch", doctor, bform, true);
  check(batch.status === 201 && batch.data.records.length === 3, "batch upload anchors 3 records");
  check(batch.data.registered === true, "batch records registered by default");

  for (const [i, r] of batch.data.records.entries()) {
    const leaf = leafFor({ recordId: r.recordId, patient: addr("patient1"), contentHash: r.contentHash, cid: r.cid });
    const ok = await anchor.verifyInclusion("0x" + leaf.toString("hex"), r.proof, batch.data.merkleRoot);
    check(ok === true, `batch record ${i}: Merkle proof verifies on-chain against the anchored root`);
    const m = await call("GET", `/records/${r.recordId}/meta`, patient);
    check(m.data.anchoredInBatch === true, `batch record ${i}: marked anchoredInBatch`);
  }
  const first = await call("GET", `/records/${batch.data.records[0].recordId}/content`, patient);
  check(first.status === 200 && Buffer.compare(first.data, batchContents[0]) === 0, "patient decrypts a batch-anchored record");

  const tampered = batch.data.records[0];
  const badLeaf = leafFor({ recordId: tampered.recordId, patient: addr("patient1"), contentHash: ethers.hexlify(ethers.randomBytes(32)), cid: tampered.cid });
  check(
    (await anchor.verifyInclusion("0x" + badLeaf.toString("hex"), tampered.proof, batch.data.merkleRoot)) === false,
    "tampered record fails Merkle verification"
  );

  const lazyForm = new FormData();
  lazyForm.append("patientAddress", addr("patient1"));
  lazyForm.append("register", "false");
  [0, 1].forEach((i) => lazyForm.append("files", new Blob([Buffer.from(`lazy ${i} ${Date.now()}`)]), `l${i}.txt`));
  const lazy = await call("POST", "/records/upload-batch", doctor, lazyForm, true);
  check(lazy.status === 201 && lazy.data.registered === false, "lazy batch (register=false) anchors the root only");
  const lazyMeta = await call("GET", `/records/${lazy.data.records[0].recordId}/meta`, patient);
  check(lazyMeta.status === 404, "lazy-batch record is provable but not individually registered on-chain");

  // 8. audit trail
  const trail = await call("GET", `/audit/${addr("patient1")}`, auditor);
  check(trail.status === 200, "auditor reads patient audit trail");
  const actions = trail.data.entries.map((e) => e.action);
  for (const a of ["RECORD_ANCHORED", "CONSENT_GRANTED", "ACCESS_GRANTED", "ACCESS_DENIED", "CONSENT_REVOKED", "EMERGENCY_ACCESS"]) {
    check(actions.includes(a), `audit trail contains ${a}`);
  }
  check(trail.data.entries.some((e) => e.isEmergency), "audit trail flags the emergency entry");

  const trailByDoctor = await call("GET", `/audit/${addr("patient1")}`, doctor);
  check(trailByDoctor.status === 500, "doctor cannot read a patient's audit trail");

  console.log(`\nAll ${passed} checks passed.`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
