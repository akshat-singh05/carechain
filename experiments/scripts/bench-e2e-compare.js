/**
 * Experiment 8 (DA-9): end-to-end REST latency of the CareChain backend
 * versus the centralised baseline (baseline-server.js), same client, same
 * payloads, same sequence of operations, sequential requests.
 *
 *   upload  : POST /records/upload   (doctor1 -> patient1, PAYLOAD bytes)
 *   grant   : POST /consent/grant    (patient1 -> doctor1, treatment, 24 h)
 *   read    : GET  /records/:id/content?purpose=treatment (doctor1, consent valid)
 *   revoke  : POST /consent/:id/revoke
 *   denied  : GET  /records/:id/content after revoke (403)
 *   break   : POST /emergency/access (erdoctor1; the daily limit is 5)
 *
 * Each iteration uploads its own record, so the per-record work is real.
 * Requires: CareChain backend on :4000 (fresh seeded chain) and the
 * baseline on :4100 (`node experiments/scripts/baseline-server.js`).
 *
 * Output: experiments/results/e2e-compare.csv, e2e-compare-summary.csv
 */
const path = require("path");
const crypto = require("crypto");
const users = require(path.join(__dirname, "..", "..", "implementation", "backend", "src", "chain", "users.json")).users;
const { writeCsv, percentile } = require("./lib/csv");

const TARGETS = { carechain: process.env.CARECHAIN_URL || "http://localhost:4000", centralised: "http://localhost:4100" };
const N = Number(process.env.N || 30);
const EMERGENCY_N = Number(process.env.EMERGENCY_N || 4); // daily break-glass limit is 5 and the e2e run used one
const WARMUP = 3;
const PAYLOAD = Number(process.env.PAYLOAD || 10240);
const addr = (u) => users.find((x) => x.username === u).address;

async function http(base, method, p, token, body, form) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !form) headers["Content-Type"] = "application/json";
  const t0 = process.hrtime.bigint();
  const res = await fetch(base + p, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  const buf = Buffer.from(await res.arrayBuffer());
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  let data = null;
  try { data = JSON.parse(buf.toString("utf8")); } catch { data = buf; }
  return { status: res.status, data, ms };
}
const login = async (base, u) => (await http(base, "POST", "/auth/login", null, { username: u, password: "password123" })).data.token;

async function runTarget(name, base, rows) {
  const [patient, doctor, er] = await Promise.all(["patient1", "doctor1", "erdoctor1"].map((u) => login(base, u)));
  const total = N + WARMUP;
  let lastRecord;
  for (let i = 0; i < total; i++) {
    const rec = (op, r, expect) => {
      if (r.status !== expect) throw new Error(`${name} ${op} iter ${i}: HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
      if (i >= WARMUP) rows.push({ system: name, operation: op, iteration: i - WARMUP, latencyMs: r.ms.toFixed(2) });
      return r;
    };
    const form = new FormData();
    form.append("patientAddress", addr("patient1"));
    form.append("file", new Blob([crypto.randomBytes(PAYLOAD)]), "rec.bin");
    const up = rec("upload", await http(base, "POST", "/records/upload", doctor, null, form), 201);
    const recordId = up.data.recordId;
    lastRecord = recordId;

    const now = Math.floor(Date.now() / 1000);
    rec("grant", await http(base, "POST", "/consent/grant", patient, { providerAddress: addr("doctor1"), recordId, purpose: "treatment", validFrom: now - 5, validUntil: now + 86400 }), 201);
    const rd = rec("read", await http(base, "GET", `/records/${recordId}/content?purpose=treatment`, doctor), 200);
    if (rd.data.length !== PAYLOAD) throw new Error(`${name}: decrypted length ${rd.data.length} != ${PAYLOAD}`);
    const mine = await http(base, "GET", "/consent/mine", patient);
    const cid = mine.data.consents[mine.data.consents.length - 1].consentId;
    rec("revoke", await http(base, "POST", `/consent/${cid}/revoke`, patient), 200);
    rec("denied", await http(base, "GET", `/records/${recordId}/content?purpose=treatment`, doctor), 403);
    if (i < EMERGENCY_N) {
      const r = await http(base, "POST", "/emergency/access", er, { patientAddress: addr("patient1"), recordId, reason: "benchmark break-glass" });
      if (r.status !== 200) throw new Error(`${name} break iter ${i}: HTTP ${r.status} ${JSON.stringify(r.data)}`);
      // all five emergency calls are measured (no warm-up: the daily limit is 5)
      rows.push({ system: name, operation: "break-glass", iteration: i, latencyMs: r.ms.toFixed(2) });
    }
  }
  console.log(`${name}: ${N} iterations done`);
}

async function main() {
  const rows = [];
  for (const [name, base] of Object.entries(TARGETS)) await runTarget(name, base, rows);
  writeCsv("e2e-compare.csv", ["system", "operation", "iteration", "latencyMs"], rows);

  const summary = [];
  for (const system of Object.keys(TARGETS)) {
    for (const op of ["upload", "grant", "read", "revoke", "denied", "break-glass"]) {
      const v = rows.filter((r) => r.system === system && r.operation === op).map((r) => Number(r.latencyMs)).sort((a, b) => a - b);
      const mean = v.reduce((a, b) => a + b, 0) / v.length;
      summary.push({ system, operation: op, n: v.length, meanMs: mean.toFixed(2), p50Ms: percentile(v, 50).toFixed(2), p95Ms: percentile(v, 95).toFixed(2) });
    }
  }
  writeCsv("e2e-compare-summary.csv", ["system", "operation", "n", "meanMs", "p50Ms", "p95Ms"], summary);
  console.table(summary);
}

main().catch((e) => { console.error(e); process.exit(1); });
