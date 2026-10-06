/**
 * Experiment 5 (PLAN.md Section 4): gas/latency cost of the ABAC,
 * time-bound, purpose-bound access check (ConsentManager.checkAndLogAccess)
 * versus a naive boolean access-flag check (benchmark/NaiveConsent.sol,
 * which is NOT part of the CareChain system -- see that file's header).
 *
 * Requires: `npx hardhat node` running in /implementation, and
 * `npm run seed:local` already run once against it (uses the resulting
 * patient1/doctor1 registrations for the ABAC side).
 *
 * Output: experiments/results/naive-vs-abac.csv
 */
const path = require("path");
const fs = require("fs");
const { ethers } = require("ethers");
const { connect, loadAbi } = require("./lib/chain");
const { writeCsv } = require("./lib/csv");

const REPS = Number(process.env.REPS || 20);

function loadArtifact(contractName, subpath) {
  const artifactPath = path.join(
    __dirname,
    "..",
    "..",
    "implementation",
    "artifacts",
    "contracts",
    `${subpath}.sol`,
    `${contractName}.json`
  );
  return JSON.parse(fs.readFileSync(artifactPath, "utf8"));
}

async function main() {
  const { provider, contracts, wallet } = connect();
  const admin = wallet(0);
  const patient1 = wallet(1); // registered by seed-demo.js
  const doctor1 = wallet(3); // registered by seed-demo.js

  // --- Deploy the naive baseline fresh (it is not part of the main deployment) ---
  const naiveArtifact = loadArtifact("NaiveConsent", "benchmark/NaiveConsent");
  const NaiveFactory = new ethers.ContractFactory(naiveArtifact.abi, naiveArtifact.bytecode, admin);
  const naive = await NaiveFactory.deploy();
  await naive.waitForDeployment();
  const naiveAsPatient = naive.connect(patient1);
  const naiveAsDoctor = naive.connect(doctor1);

  await (await naiveAsPatient.grant(doctor1.address)).wait();

  const rows = [];

  // --- Naive: boolean check (view -- for a fair gas comparison we call the
  // state-changing grant/revoke path once, then measure the READ cost via a
  // wrapping transaction pattern is not meaningful for a `view` function, so
  // we instead compare the two GRANT paths' gas, and separately the two
  // ACCESS-CHECK paths' latency for an off-chain view call.) ---
  for (let i = 0; i < REPS; i++) {
    // naive grant (already granted once above; re-grant is idempotent and cheap to repeat)
    const start = process.hrtime.bigint();
    const tx = await naiveAsPatient.grant(doctor1.address);
    const receipt = await tx.wait();
    const end = process.hrtime.bigint();
    rows.push({
      variant: "naive",
      operation: "grant",
      iteration: i,
      latencyMs: (Number(end - start) / 1e6).toFixed(2),
      gasUsed: Number(receipt.gasUsed),
    });
  }

  for (let i = 0; i < REPS; i++) {
    const start = process.hrtime.bigint();
    await naiveAsDoctor.checkAccess(patient1.address, doctor1.address);
    const end = process.hrtime.bigint();
    rows.push({
      variant: "naive",
      operation: "checkAccess (view call)",
      iteration: i,
      latencyMs: (Number(end - start) / 1e6).toFixed(2),
      gasUsed: "", // view calls consume no gas when called off-chain via eth_call
    });
  }

  // --- ABAC: ConsentManager ---
  const now = Math.floor(Date.now() / 1000);
  for (let i = 0; i < REPS; i++) {
    const start = process.hrtime.bigint();
    const tx = await contracts.consentManager
      .connect(patient1)
      .grantConsent(doctor1.address, ethers.ZeroHash, "treatment", now, now + 3600 + i);
    const receipt = await tx.wait();
    const end = process.hrtime.bigint();
    rows.push({
      variant: "abac",
      operation: "grantConsent",
      iteration: i,
      latencyMs: (Number(end - start) / 1e6).toFixed(2),
      gasUsed: Number(receipt.gasUsed),
    });
  }

  const recordId = ethers.hexlify(ethers.randomBytes(32));
  for (let i = 0; i < REPS; i++) {
    const start = process.hrtime.bigint();
    await contracts.consentManager.isConsentValid(patient1.address, doctor1.address, recordId, "treatment");
    const end = process.hrtime.bigint();
    rows.push({
      variant: "abac",
      operation: "isConsentValid (view call)",
      iteration: i,
      latencyMs: (Number(end - start) / 1e6).toFixed(2),
      gasUsed: "",
    });
  }

  // Also record the STATE-CHANGING checkAndLogAccess variant (writes an audit
  // entry, so it is directly comparable in kind to the naive contract having
  // no audit trail at all -- this is the real apples-to-apples ABAC-overhead
  // number to headline in the paper, since it is a transaction, not a view call).
  for (let i = 0; i < REPS; i++) {
    const start = process.hrtime.bigint();
    const tx = await contracts.consentManager.connect(doctor1).checkAndLogAccess(patient1.address, recordId, "treatment");
    const receipt = await tx.wait();
    const end = process.hrtime.bigint();
    rows.push({
      variant: "abac",
      operation: "checkAndLogAccess (tx, writes audit entry)",
      iteration: i,
      latencyMs: (Number(end - start) / 1e6).toFixed(2),
      gasUsed: Number(receipt.gasUsed),
    });
  }

  writeCsv("naive-vs-abac.csv", ["variant", "operation", "iteration", "latencyMs", "gasUsed"], rows);

  const grouped = {};
  for (const r of rows) {
    const key = `${r.variant}:${r.operation}`;
    (grouped[key] ||= []).push(r);
  }
  console.table(
    Object.entries(grouped).map(([key, group]) => {
      const gasVals = group.map((g) => g.gasUsed).filter((g) => g !== "");
      const meanGas = gasVals.length ? gasVals.reduce((a, b) => a + b, 0) / gasVals.length : null;
      return { operation: key, n: group.length, meanGasUsed: meanGas };
    })
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
