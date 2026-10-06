/**
 * Experiment 2 (PLAN.md Section 4): scalability under concurrent load.
 * Fires `concurrency` simultaneous anchorRecord calls (chosen as the
 * representative write-heavy operation) from `concurrency` distinct,
 * pre-funded, pre-registered provider wallets, all against ONE shared
 * pre-registered patient, and measures per-call latency and the wall-clock
 * throughput of the whole batch, plus the revert/error rate.
 *
 * Requires: `npx hardhat node` running in /implementation, and
 * `npm run seed:local` already run once against it.
 *
 * Output: experiments/results/concurrency.csv (per-call rows) and
 * experiments/results/concurrency-summary.csv (per-level aggregates).
 */
const { ethers } = require("ethers");
const { connect } = require("./lib/chain");
const { writeCsv, percentile } = require("./lib/csv");

const LEVELS = (process.env.LEVELS || "10,50,100,200").split(",").map(Number);
// Wide separation between levels' HD-wallet index ranges so no two levels reuse an address.
const BASE_INDEX = 1000;

async function fundWallet(adminWallet, wallet, ethAmount = "1.0") {
  const tx = await adminWallet.sendTransaction({ to: wallet.address, value: ethers.parseEther(ethAmount) });
  return tx.wait();
}

async function main() {
  const { contracts, wallet, deployment } = connect();
  const admin = wallet(0);
  if (admin.address.toLowerCase() !== deployment.admin.toLowerCase()) {
    throw new Error("Derived admin wallet does not match deployment.admin.");
  }

  // One shared patient for every level (registered once, up front).
  const sharedPatient = wallet(BASE_INDEX - 1);
  await fundWallet(admin, sharedPatient);
  await (await contracts.registry.connect(admin).registerPatient(sharedPatient.address, "cid://concurrency-patient")).wait();

  const perCallRows = [];
  const summaryRows = [];
  let indexCursor = BASE_INDEX;

  for (const level of LEVELS) {
    console.log(`\n=== Concurrency level: ${level} ===`);
    const providers = [];
    for (let i = 0; i < level; i++) {
      const w = wallet(indexCursor++);
      await fundWallet(admin, w);
      providers.push(w);
    }
    // Register all providers for this level sequentially (setup, not timed).
    for (const p of providers) {
      await (
        await contracts.registry.connect(admin).registerProvider(p.address, "Bench Provider", "General", "Bench", false)
      ).wait();
    }

    const wallStart = process.hrtime.bigint();
    const results = await Promise.allSettled(
      providers.map(async (p, i) => {
        const recordId = ethers.hexlify(ethers.randomBytes(32));
        const contentHash = ethers.hexlify(ethers.randomBytes(32));
        const callStart = process.hrtime.bigint();
        const tx = await contracts.recordAnchor
          .connect(p)
          .anchorRecord(recordId, sharedPatient.address, contentHash, `local://conc-${level}-${i}`);
        const receipt = await tx.wait();
        const callEnd = process.hrtime.bigint();
        return { latencyMs: Number(callEnd - callStart) / 1e6, gasUsed: Number(receipt.gasUsed) };
      })
    );
    const wallEnd = process.hrtime.bigint();
    const wallSeconds = Number(wallEnd - wallStart) / 1e9;

    const latencies = [];
    let errors = 0;
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        latencies.push(r.value.latencyMs);
        perCallRows.push({ concurrency: level, client: i, latencyMs: r.value.latencyMs, gasUsed: r.value.gasUsed, error: "" });
      } else {
        errors += 1;
        perCallRows.push({ concurrency: level, client: i, latencyMs: "", gasUsed: "", error: r.reason?.message || "unknown" });
      }
    });

    const sorted = [...latencies].sort((a, b) => a - b);
    const mean = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : NaN;
    summaryRows.push({
      concurrency: level,
      succeeded: latencies.length,
      errors,
      errorRatePct: ((errors / level) * 100).toFixed(2),
      wallClockSeconds: wallSeconds.toFixed(3),
      throughputTps: (latencies.length / wallSeconds).toFixed(2),
      meanLatencyMs: latencies.length ? mean.toFixed(2) : "",
      p95LatencyMs: latencies.length ? percentile(sorted, 95).toFixed(2) : "",
    });
    console.table(summaryRows[summaryRows.length - 1]);
  }

  writeCsv("concurrency.csv", ["concurrency", "client", "latencyMs", "gasUsed", "error"], perCallRows);
  writeCsv(
    "concurrency-summary.csv",
    ["concurrency", "succeeded", "errors", "errorRatePct", "wallClockSeconds", "throughputTps", "meanLatencyMs", "p95LatencyMs"],
    summaryRows
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
