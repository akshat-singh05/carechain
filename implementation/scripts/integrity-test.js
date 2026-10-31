/**
 * Integrity regression test for the read route: a stored ciphertext that no
 * longer hashes to the value anchored on-chain must be rejected (HTTP 409),
 * both for a corrupted blob and for a forgery re-encrypted under the record's
 * own key (which AES-GCM alone would accept).
 *
 * Requires the backend (API_URL, default http://localhost:4000) running on a
 * seeded chain, on the same machine (it edits the local blob store).
 *   npm run test:integrity
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const BASE = process.env.API_URL || "http://localhost:4000";
const users = require("../backend/src/chain/users.json").users;
const keystore = require("../backend/src/services/keystore");
const config = require("../backend/src/config");
const addr = (u) => users.find((x) => x.username === u).address;

let failures = 0;
function check(name, ok, extra = "") {
  console.log(`${ok ? "ok  " : "FAIL"} - ${name}${ok || !extra ? "" : " (" + extra + ")"}`);
  if (!ok) failures++;
}

async function call(method, p, token, body, form) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE + p, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, text: buf.toString("utf8") };
}
const login = async (u) => JSON.parse((await call("POST", "/auth/login", null, { username: u, password: "password123" })).text).token;

async function main() {
  const [doctor, patient] = await Promise.all([login("doctor1"), login("patient1")]);
  const original = "integrity test record " + Date.now();
  const form = new FormData();
  form.append("patientAddress", addr("patient1"));
  form.append("file", new Blob([Buffer.from(original)]), "r.txt");
  const up = JSON.parse((await call("POST", "/records/upload", doctor, null, form)).text);
  const now = Math.floor(Date.now() / 1000);
  await call("POST", "/consent/grant", patient, { providerAddress: addr("doctor1"), recordId: up.recordId, purpose: "treatment", validFrom: now - 5, validUntil: now + 3600 });

  const read = () => call("GET", `/records/${up.recordId}/content?purpose=treatment`, doctor);
  const file = path.join(config.storageDir, up.cid.replace("local://", ""));
  const good = fs.readFileSync(file);

  const r0 = await read();
  check("untouched record decrypts to the original", r0.status === 200 && r0.text === original, `HTTP ${r0.status}`);

  const corrupt = Buffer.from(good);
  corrupt[40] ^= 0x01;
  fs.writeFileSync(file, corrupt);
  const r1 = await read();
  check("corrupted ciphertext is rejected (409)", r1.status === 409 && /Integrity check failed/.test(r1.text), `HTTP ${r1.status} ${r1.text.slice(0, 60)}`);

  const key = keystore.unwrap(up.recordId);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(Buffer.from("FORGED CONTENT")), c.final()]);
  fs.writeFileSync(file, Buffer.concat([iv, c.getAuthTag(), ct]));
  const r2 = await read();
  check("forgery re-encrypted under the record key is rejected (409)", r2.status === 409 && !/FORGED/.test(r2.text), `HTTP ${r2.status} ${r2.text.slice(0, 60)}`);

  fs.writeFileSync(file, good);
  const r3 = await read();
  check("restored ciphertext reads normally again", r3.status === 200 && r3.text === original, `HTTP ${r3.status}`);

  if (failures) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll integrity checks passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
