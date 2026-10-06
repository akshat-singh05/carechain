/**
 * Experiment 1 (PLAN.md Section 4): per-operation latency and throughput for
 * registerPatient, registerProvider, anchorRecord, grantConsent,
 * revokeConsent, requestAccess (checkAndLogAccess).
 *
 * Requires: `npx hardhat node` running in /implementation, and
 * `npm run seed:local` already run once against it.
 *
 * Output: experiments/results/latency-throughput.csv
 * Columns: operation,iteration,latencyMs,gasUsed
 * Plus experiments/results/latency-throughput-summary.csv with p50/p95/mean
 * latency and throughput (tx/s) per operation.
 */
const { ethers } = require("ethers");
const { connect } = require("./lib/chain");
const { writeCsv, percentile } = require("./lib/csv");

const N = Number(process.env.N || 30);
const START_INDEX = 100; // fresh HD-wallet indices, well past seed-demo's 0-5

async function fundWallet(adminWallet, wallet, ethAmount = "1.0") {
  const tx = await adminWallet.sendTransaction({ to: wallet.address, value: ethers.parseEther(ethAmount) });
  await tx.wait();
}

async function timeIt(fn) {
  const start = process.hrtime.bigint();
  const receipt = await fn();
  const end = process.hrtime.bigint();
  const latencyMs = Number(end - start) / 1e6;
  return { latencyMs, gasUsed: receipt ? Number(receipt.gasUsed) : null };
}

async function main() {
  const { provider, contracts, wallet, deployment } = connect();
  const admin = wallet(0);
  if (admin.address.toLowerCase() !== deployment.admin.toLowerCase()) {
    throw new Error("Derived admin wallet does not match deployment.admin -- was a non-default mnemonic used?");
  }

  const rows = [];

  // Pre-generate + fund all actor wallets used below (setup, not timed).
  const patientWallets = [];
  const providerWallets = [];
  for (let i = 0; i < N; i++) {
    const p = wallet(START_INDEX + i);
    const d = wallet(START_INDEX + N + i);
    await fundWallet(admin, p);
    await fundWallet(admin, d);
    patientWallets.push(p);
    providerWallets.push(d);
  }

  // --- registerPatient ---
  for (let i = 0; i < N; i++) {
    const { latencyMs, gasUsed } = await timeIt(async () => {
      const tx = await contracts.registry
        .connect(admin)
        .registerPatient(patientWallets[i].address, `cid://bench-patient-${i}`);
      return tx.wait();
    });
    rows.push({ operation: "registerPatient", iteration: i, latencyMs, gasUsed });
  }

  // --- registerProvider ---
  for (let i = 0; i < N; i++) {
    const { latencyMs, gasUsed } = await timeIt(async () => {
      const tx = await contracts.registry
        .connect(admin)
        .registerProvider(providerWallets[i].address, `Dr. Bench ${i}`, "General", "Bench Hospital", false);
      return tx.wait();
    });
    rows.push({ operation: "registerProvider", iteration: i, latencyMs, gasUsed });
  }

  // --- anchorRecord (by provider[i] for patient[i]) ---
  const recordIds = [];
  for (let i = 0; i < N; i++) {
    const recordId = ethers.hexlify(ethers.randomBytes(32));
    const contentHash = ethers.hexlify(ethers.randomBytes(32));
    const { latencyMs, gasUsed } = await timeIt(async () => {
      const tx = await contracts.recordAnchor
        .connect(providerWallets[i])
        .anchorRecord(recordId, patientWallets[i].address, contentHash, `local://bench-${i}`);
      return tx.wait();
    });
    recordIds.push(recordId);
    rows.push({ operation: "anchorRecord", iteration: i, latencyMs, gasUsed });
  }

  // --- grantConsent (patient[i] -> provider[i]) ---
  const now = Math.floor(Date.now() / 1000);
  for (let i = 0; i < N; i++) {
    const { latencyMs, gasUsed } = await timeIt(async () => {
      const tx = await contracts.consentManager
        .connect(patientWallets[i])
        .grantConsent(providerWallets[i].address, ethers.ZeroHash, "treatment", now, now + 3600);
      return tx.wait();
    });
    rows.push({ operation: "grantConsent", iteration: i, latencyMs, gasUsed });
  }

  // --- requestAccess / checkAndLogAccess (provider[i] against patient[i]) ---
  for (let i = 0; i < N; i++) {
    const { latencyMs, gasUsed } = await timeIt(async () => {
      const tx = await contracts.consentManager
        .connect(providerWallets[i])
        .checkAndLogAccess(patientWallets[i].address, recordIds[i], "treatment");
      return tx.wait();
    });
    rows.push({ operation: "requestAccess", iteration: i, latencyMs, gasUsed });
  }

  // --- revokeConsent (consent id == i, since each patient granted exactly once, in order) ---
  for (let i = 0; i < N; i++) {
    const { latencyMs, gasUsed } = await timeIt(async () => {
      const tx = await contracts.consentManager.connect(patientWallets[i]).revokeConsent(i);
      return tx.wait();
    });
    rows.push({ operation: "revokeConsent", iteration: i, latencyMs, gasUsed });
  }

  writeCsv("latency-throughput.csv", ["operation", "iteration", "latencyMs", "gasUsed"], rows);

  const byOp = {};
  for (const r of rows) {
    (byOp[r.operation] ||= []).push(r.latencyMs);
  }
  const summary = Object.entries(byOp).map(([operation, latencies]) => {
    const sorted = [...latencies].sort((a, b) => a - b);
    const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    const totalSeconds = latencies.reduce((a, b) => a + b, 0) / 1000;
    return {
      operation,
      n: latencies.length,
      meanLatencyMs: mean.toFixed(2),
      p50LatencyMs: percentile(sorted, 50).toFixed(2),
      p95LatencyMs: percentile(sorted, 95).toFixed(2),
      throughputTps: (latencies.length / totalSeconds).toFixed(2),
    };
  });
  writeCsv(
    "latency-throughput-summary.csv",
    ["operation", "n", "meanLatencyMs", "p50LatencyMs", "p95LatencyMs", "throughputTps"],
    summary
  );

  console.table(summary);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
