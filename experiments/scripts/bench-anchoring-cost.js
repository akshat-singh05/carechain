/**
 * Experiment 4 (PLAN.md Section 4): individual vs. Merkle-batched anchoring
 * cost, contribution (d).
 *
 * IMPORTANT framing (also stated in the paper's Performance Evaluation
 * section -- do not simplify this away when writing it up): the anchoring
 * *guarantee* for a batched record comes from `anchorBatch`'s single
 * Merkle-root write plus an off-chain Merkle proof (verifiable any time via
 * the pure `verifyInclusion` call, at no storage cost). `registerBatchRecord`
 * is a SEPARATE, optional, lazy step that additionally makes one record's
 * metadata directly queryable on-chain via `getRecord` -- it is not required
 * just to have anchored the record. So this script reports three numbers per
 * batch size:
 *   - individualGasPerRecord: baseline, one anchorRecord tx per record
 *   - batchRootGasPerRecordAmortized: cost of just the anchorBatch tx,
 *     divided by batch size -- this is the number contribution (d) claims
 *     savings on
 *   - batchRegisterGasPerRecord: gas cost of ALSO calling
 *     registerBatchRecord for every record (i.e. the cost if you want every
 *     record individually queryable on-chain immediately, forfeiting the
 *     lazy-verification benefit)
 *
 * Requires: `npx hardhat node` running in /implementation, and
 * `npm run seed:local` already run once against it.
 *
 * Output: experiments/results/anchoring-cost.csv
 */
const { ethers } = require("ethers");
const { connect } = require("./lib/chain");
const { writeCsv } = require("./lib/csv");
const { buildTree, getRoot, getProof } = require("../../implementation/scripts/lib/merkle");

const BATCH_SIZES = (process.env.BATCH_SIZES || "1,5,10,25,50").split(",").map(Number);
const BASE_INDEX = 2000;

async function fundWallet(adminWallet, wallet, ethAmount = "1.0") {
  const tx = await adminWallet.sendTransaction({ to: wallet.address, value: ethers.parseEther(ethAmount) });
  return tx.wait();
}

function makeRecords(n, patientAddress) {
  return Array.from({ length: n }, () => ({
    recordId: ethers.hexlify(ethers.randomBytes(32)),
    patient: patientAddress,
    contentHash: ethers.hexlify(ethers.randomBytes(32)),
    cid: `local://${ethers.hexlify(ethers.randomBytes(16))}`,
  }));
}

async function main() {
  const { contracts, wallet, deployment } = connect();
  const admin = wallet(0);
  if (admin.address.toLowerCase() !== deployment.admin.toLowerCase()) {
    throw new Error("Derived admin wallet does not match deployment.admin.");
  }

  const patient = wallet(BASE_INDEX - 1);
  await fundWallet(admin, patient);
  await (await contracts.registry.connect(admin).registerPatient(patient.address, "cid://anchoring-bench-patient")).wait();

  const provider = wallet(BASE_INDEX - 2);
  await fundWallet(admin, provider);
  await (
    await contracts.registry.connect(admin).registerProvider(provider.address, "Bench Provider", "General", "Bench", false)
  ).wait();

  const rows = [];

  for (const size of BATCH_SIZES) {
    console.log(`\n=== Batch size: ${size} ===`);

    // --- Individual anchoring baseline ---
    const individualRecords = makeRecords(size, patient.address);
    let individualGasTotal = 0n;
    for (const rec of individualRecords) {
      const tx = await contracts.recordAnchor
        .connect(provider)
        .anchorRecord(rec.recordId, rec.patient, rec.contentHash, rec.cid);
      const receipt = await tx.wait();
      individualGasTotal += receipt.gasUsed;
    }

    // --- Merkle-batched anchoring ---
    const batchRecords = makeRecords(size, patient.address);
    const { tree, leaves } = buildTree(batchRecords);
    const root = getRoot(tree);
    const batchTx = await contracts.recordAnchor.connect(provider).anchorBatch(root, size, `local://manifest-${size}`);
    const batchReceipt = await batchTx.wait();
    const batchGas = batchReceipt.gasUsed;

    // Find the batch id we just created by reading totalBatches() - 1.
    const batchId = (await contracts.recordAnchor.totalBatches()) - 1n;

    // --- Optional lazy per-record registration (reported separately, see header comment) ---
    let registerGasTotal = 0n;
    for (let i = 0; i < batchRecords.length; i++) {
      const proof = getProof(tree, leaves[i]);
      const tx = await contracts.recordAnchor
        .connect(provider)
        .registerBatchRecord(batchId, batchRecords[i].recordId, batchRecords[i].patient, batchRecords[i].contentHash, batchRecords[i].cid, proof);
      const receipt = await tx.wait();
      registerGasTotal += receipt.gasUsed;
    }

    rows.push({
      batchSize: size,
      individualTxCount: size,
      individualGasTotal: individualGasTotal.toString(),
      individualGasPerRecord: (Number(individualGasTotal) / size).toFixed(1),
      batchRootTxCount: 1,
      batchRootGasTotal: batchGas.toString(),
      batchRootGasPerRecordAmortized: (Number(batchGas) / size).toFixed(1),
      batchRegisterGasTotal: registerGasTotal.toString(),
      batchRegisterGasPerRecord: (Number(registerGasTotal) / size).toFixed(1),
    });
    console.table(rows[rows.length - 1]);
  }

  writeCsv(
    "anchoring-cost.csv",
    [
      "batchSize",
      "individualTxCount",
      "individualGasTotal",
      "individualGasPerRecord",
      "batchRootTxCount",
      "batchRootGasTotal",
      "batchRootGasPerRecordAmortized",
      "batchRegisterGasTotal",
      "batchRegisterGasPerRecord",
    ],
    rows
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
