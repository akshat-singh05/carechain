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
