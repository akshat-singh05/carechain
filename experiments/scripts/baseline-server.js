/**
 * Centralised baseline for the DA-9 comparison (NOT part of CareChain).
 *
 * A hospital-style service with the SAME REST surface as the CareChain
 * backend (login, upload, grant consent, read, revoke, break-glass), the
 * SAME AES-256-GCM envelope encryption (it re-uses the backend's crypto
 * module) and the same file store for ciphertext, but with every
 * blockchain-backed element replaced by ordinary in-memory tables:
 * consents, record metadata and the audit log live in JS arrays/maps
 * (the fastest possible "database", i.e. a lower bound on a real DBMS).
 * There is no ledger, no signing, no mining and no gas.
 *
 * Usage: node baseline-server.js   (listens on BASELINE_PORT, default 4100)
 */
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const IMPL = path.join(__dirname, "..", "..", "implementation");
const req = (m) => require(path.join(IMPL, "node_modules", m));
const express = req("express");
const multer = req("multer");
const jwt = req("jsonwebtoken");
const { encryptRecord, decryptRecord, sha256Hex } = require(path.join(IMPL, "backend", "src", "services", "crypto"));
const users = require(path.join(IMPL, "backend", "src", "chain", "users.json")).users;

const PORT = Number(process.env.BASELINE_PORT || 4100);
const SECRET = "baseline-secret";
const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "baseline-store-"));

// "Database" tables
const records = new Map(); // recordId -> {patient, uploader, hash, file, key}
const consents = []; // {patient, provider, recordId, purpose, from, until, revoked}
const audit = []; // {at, actor, subject, action, purpose, emergency}
const emergencyCount = new Map();

const app = express();
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage() });

function auth(role) {
  return (rq, rs, next) => {
    try {
      const token = (rq.headers.authorization || "").replace("Bearer ", "");
      rq.user = jwt.verify(token, SECRET);
    } catch {
      return rs.status(401).json({ error: "unauthenticated" });
    }
    if (role && rq.user.role !== role) return rs.status(403).json({ error: "wrong role" });
    next();
  };
}
const log = (actor, subject, action, purpose = "", emergency = false) =>
  audit.push({ at: Date.now(), actor, subject, action, purpose, emergency });

app.post("/auth/login", (rq, rs) => {
  const { username, password } = rq.body || {};
  const u = users.find((x) => x.username === username);
  if (!u || password !== "password123") return rs.status(401).json({ error: "Invalid credentials" });
  const token = jwt.sign({ username: u.username, role: u.role, address: u.address }, SECRET, { expiresIn: "8h" });
  rs.json({ token, user: { username: u.username, role: u.role, address: u.address } });
});

app.post("/records/upload", auth("provider"), upload.single("file"), (rq, rs) => {
  const { blob, key } = encryptRecord(rq.file.buffer);
  const hash = sha256Hex(blob);
  const file = path.join(storeDir, hash);
  fs.writeFileSync(file, blob);
  const recordId = "0x" + crypto.randomBytes(32).toString("hex");
  records.set(recordId, { patient: rq.body.patientAddress, uploader: rq.user.address, hash, file, key });
  log(rq.user.address, rq.body.patientAddress, "RECORD_UPLOADED");
  rs.status(201).json({ recordId, contentHash: "0x" + hash, cid: "local://" + hash });
});

app.post("/consent/grant", auth("patient"), (rq, rs) => {
  const { providerAddress, recordId, purpose, validFrom, validUntil } = rq.body || {};
  if (!providerAddress || !validUntil) return rs.status(400).json({ error: "providerAddress and validUntil are required" });
  consents.push({ id: consents.length, patient: rq.user.address, provider: providerAddress, recordId: recordId || null, purpose: purpose || "", from: validFrom || 0, until: validUntil, revoked: false });
  log(rq.user.address, rq.user.address, "CONSENT_GRANTED", purpose);
  rs.status(201).json({ consentId: consents.length - 1 });
});

app.get("/consent/mine", auth("patient"), (rq, rs) =>
  rs.json({ consents: consents.filter((c) => c.patient === rq.user.address).map((c) => ({ consentId: c.id, ...c })) })
);

app.post("/consent/:id/revoke", auth("patient"), (rq, rs) => {
  const c = consents[Number(rq.params.id)];
  if (!c || c.patient !== rq.user.address) return rs.status(403).json({ error: "not your consent" });
  c.revoked = true;
  log(rq.user.address, rq.user.address, "CONSENT_REVOKED");
  rs.json({ ok: true });
});

app.get("/records/:id/content", auth(), (rq, rs) => {
  const rec = records.get(rq.params.id);
  if (!rec) return rs.status(404).json({ error: "record not found" });
  const purpose = rq.query.purpose || "treatment";
  const now = Math.floor(Date.now() / 1000);
  let ok = rq.user.role === "patient" && rec.patient === rq.user.address;
  if (rq.user.role === "provider") {
    ok = consents.some(
      (c) => c.patient === rec.patient && c.provider === rq.user.address && !c.revoked && now >= c.from && now <= c.until &&
        (!c.recordId || c.recordId === rq.params.id) && (!c.purpose || c.purpose === purpose)
    );
    log(rq.user.address, rec.patient, ok ? "ACCESS_GRANTED" : "ACCESS_DENIED", purpose);
  }
  if (!ok) return rs.status(403).json({ error: "Access denied" });
  rs.send(decryptRecord(fs.readFileSync(rec.file), rec.key));
});

app.post("/emergency/access", auth("provider"), (rq, rs) => {
  const { patientAddress, recordId, reason } = rq.body || {};
  if (!patientAddress || !recordId || !reason) return rs.status(400).json({ error: "missing fields" });
  const u = users.find((x) => x.address === rq.user.address);
  if (!u || u.username !== "erdoctor1") return rs.status(500).json({ error: "caller is not a credentialed emergency responder" });
  const day = new Date().toDateString() + rq.user.address;
  if ((emergencyCount.get(day) || 0) >= 5) return rs.status(500).json({ error: "daily emergency limit reached" });
  emergencyCount.set(day, (emergencyCount.get(day) || 0) + 1);
  log(rq.user.address, patientAddress, "EMERGENCY_ACCESS", reason, true);
  rs.json({ eventId: audit.length - 1, notified: true });
});

// Test hooks used by the tamper experiment (the "insider with database access").
app.get("/_admin/audit", (rq, rs) => rs.json({ audit }));
app.post("/_admin/audit/edit", (rq, rs) => {
  const { index, patch } = rq.body;
  Object.assign(audit[index], patch);
  rs.json({ edited: audit[index] });
});
app.post("/_admin/forge", (rq, rs) => {
  // Insider with database + key access: re-encrypts altered content under the
  // record's own key and updates the stored hash to match. Leaves no trace.
  const { recordId, text } = rq.body;
  const rec = records.get(recordId);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", rec.key, iv);
  const ct = Buffer.concat([c.update(Buffer.from(text)), c.final()]);
  const blob = Buffer.concat([iv, c.getAuthTag(), ct]);
  fs.writeFileSync(rec.file, blob);
  rec.hash = sha256Hex(blob);
  rs.json({ forged: true, newHash: rec.hash });
});
app.get("/_admin/store", (rq, rs) => rs.json({ dir: storeDir, records: [...records.entries()].map(([id, r]) => ({ id, file: r.file, hash: r.hash })) }));

app.listen(PORT, () => console.log(`Baseline (centralised) service on http://localhost:${PORT}`));
