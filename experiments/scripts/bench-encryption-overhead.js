/**
 * Experiment 3 (PLAN.md Section 4): off-chain AES-256-GCM encryption /
 * decryption overhead as a function of record size. Uses the exact same
 * `encryptRecord`/`decryptRecord` functions the backend uses
 * (backend/src/services/crypto.js), so this measures the real code path,
 * not a re-implementation. Pure Node.js -- no chain/RPC dependency, so this
 * script can run even before `hardhat node` / seeding.
 *
 * Output: experiments/results/encryption-overhead.csv (per-run rows) and
 * experiments/results/encryption-overhead-summary.csv (mean per size).
 */
const path = require("path");
const crypto = require("crypto");
const { encryptRecord, decryptRecord } = require(
  path.join(__dirname, "..", "..", "implementation", "backend", "src", "services", "crypto.js")
);
const { writeCsv } = require("./lib/csv");

const SIZES = { "100KB": 100 * 1024, "1MB": 1 * 1024 * 1024, "10MB": 10 * 1024 * 1024 };
const REPS = Number(process.env.REPS || 20);

function timeMs(fn) {
  const start = process.hrtime.bigint();
  const result = fn();
  const end = process.hrtime.bigint();
  return { ms: Number(end - start) / 1e6, result };
}

async function main() {
  const rows = [];

  for (const [label, size] of Object.entries(SIZES)) {
    for (let i = 0; i < REPS; i++) {
      const plaintext = crypto.randomBytes(size);

      const enc = timeMs(() => encryptRecord(plaintext));
      const { blob, key } = enc.result;

      const dec = timeMs(() => decryptRecord(blob, key));

      rows.push({
        sizeLabel: label,
        sizeBytes: size,
        iteration: i,
        encryptMs: enc.ms.toFixed(3),
        decryptMs: dec.ms.toFixed(3),
      });
    }
    console.log(`Done: ${label} (${REPS} reps)`);
  }

  writeCsv("encryption-overhead.csv", ["sizeLabel", "sizeBytes", "iteration", "encryptMs", "decryptMs"], rows);

  const bySize = {};
  for (const r of rows) {
    (bySize[r.sizeLabel] ||= { sizeBytes: r.sizeBytes, enc: [], dec: [] });
    bySize[r.sizeLabel].enc.push(Number(r.encryptMs));
    bySize[r.sizeLabel].dec.push(Number(r.decryptMs));
  }
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const summary = Object.entries(bySize).map(([sizeLabel, v]) => ({
    sizeLabel,
    sizeBytes: v.sizeBytes,
    meanEncryptMs: mean(v.enc).toFixed(3),
    meanDecryptMs: mean(v.dec).toFixed(3),
    throughputEncryptMBps: (v.sizeBytes / 1e6 / (mean(v.enc) / 1000)).toFixed(2),
    throughputDecryptMBps: (v.sizeBytes / 1e6 / (mean(v.dec) / 1000)).toFixed(2),
  }));
  writeCsv(
    "encryption-overhead-summary.csv",
    ["sizeLabel", "sizeBytes", "meanEncryptMs", "meanDecryptMs", "throughputEncryptMBps", "throughputDecryptMBps"],
    summary
  );
  console.table(summary);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
