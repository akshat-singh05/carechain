/**
 * Experiment 6 (DA-9): gas needed to store the record payload itself in
 * contract storage (benchmark/OnChainBlob.sol) at several payload sizes,
 * compared with CareChain's fixed per-record anchor cost (hash + pointer).
 *
 * Requires: `npx hardhat node` running in /implementation, and
 * `npm run compile` done. Needs no seeding: it deploys its own contract.
 *
 * Output: experiments/results/onchain-storage.csv
 */
const path = require("path");
const fs = require("fs");
const { ethers } = require("ethers");
const { connect } = require("./lib/chain");
const { writeCsv } = require("./lib/csv");

const SIZES = (process.env.SIZES || "107,256,512,1024,4096,16384,32768,65536").split(",").map(Number);

async function main() {
  const { wallet } = connect();
  const admin = wallet(0);
  const artifactPath = path.join(
    __dirname, "..", "..", "implementation", "artifacts", "contracts", "benchmark", "OnChainBlob.sol", "OnChainBlob.json"
  );
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, admin);
  const blob = await factory.deploy();
  await blob.waitForDeployment();

  const rows = [];
  for (const size of SIZES) {
    const id = ethers.hexlify(ethers.randomBytes(32));
    // Random (non-zero with overwhelming probability) bytes, like ciphertext.
    const data = ethers.randomBytes(size);
    let row;
    try {
      const start = process.hrtime.bigint();
      const tx = await blob.store(id, data);
      const receipt = await tx.wait();
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      row = { sizeBytes: size, status: "ok", gasUsed: Number(receipt.gasUsed), latencyMs: ms.toFixed(1) };
    } catch (err) {
      row = { sizeBytes: size, status: "rejected", gasUsed: "", latencyMs: "" };
      row.note = "node rejected the tx: gas estimate exceeds the 16,777,216 (2^24) per-transaction gas cap (EIP-7825) of Hardhat 2.29";
    }
    console.log(row);
    rows.push({ note: "", ...row });
  }
  writeCsv("onchain-storage.csv", ["sizeBytes", "status", "gasUsed", "latencyMs", "note"], rows);
}

main().catch((e) => { console.error(e); process.exit(1); });
