const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const IMPL_DIR = path.join(__dirname, "..", "..", "..", "implementation");
const ARTIFACTS_DIR = path.join(IMPL_DIR, "artifacts", "contracts");
const DEPLOYMENT_PATH = path.join(IMPL_DIR, "backend", "src", "chain", "deployment.json");

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
// Same well-known local Hardhat dev mnemonic used by implementation/scripts/seed-demo.js.
// See that file's header comment for why this is safe ONLY on a local Hardhat network.
const DEV_MNEMONIC = "test test test test test test test test test test test junk";

function loadAbi(contractName, subpath = contractName) {
  const abiPath = path.join(ARTIFACTS_DIR, `${subpath}.sol`, `${contractName}.json`);
  if (!fs.existsSync(abiPath)) {
    throw new Error(`Missing artifact ${abiPath}. Run "npm run compile" in /implementation first.`);
  }
  return JSON.parse(fs.readFileSync(abiPath, "utf8")).abi;
}

function loadDeployment() {
  if (!fs.existsSync(DEPLOYMENT_PATH)) {
    throw new Error(
      `Missing ${DEPLOYMENT_PATH}. Run "npx hardhat node" then "npm run seed:local" in /implementation first.`
    );
  }
  return JSON.parse(fs.readFileSync(DEPLOYMENT_PATH, "utf8"));
}

function hardhatWallet(index, provider) {
  const wallet = ethers.HDNodeWallet.fromPhrase(DEV_MNEMONIC, undefined, `m/44'/60'/0'/0/${index}`).connect(
    provider
  );
  // Wrapped in ethers' built-in NonceManager: it fetches the on-chain nonce
  // once, then increments locally on every send instead of re-querying
  // "pending" nonce each time. Plain re-querying was observed to race with
  // Hardhat's automining (a `getTransactionCount(addr, "pending")` issued
  // immediately after the previous tx's block was mined could still return
  // a stale count), causing "nonce too low" errors under the many
  // sequential sends-from-one-wallet loops these benchmark scripts do.
  const managed = new ethers.NonceManager(wallet);
  // NonceManager only exposes async getAddress(); every benchmark script
  // reads `.address` synchronously (matching plain Wallet's API), so mirror
  // it as a plain property here rather than rewriting every call site.
  managed.address = wallet.address;
  return managed;
}

/**
 * Returns { provider, deployment, contracts, wallets } where `contracts` are
 * read-only instances and `wallets(i)` derives signer #i from the same dev
 * mnemonic seed-demo.js used (0=admin, 1=patient1, 2=patient2, 3=doctor1,
 * 4=erdoctor1, 5=auditor1), plus fresh indices (>=6) for synthetic
 * concurrency-benchmark actors that were never registered by seed-demo.js --
 * scripts that need those must register them first via the registry.
 */
function connect() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const deployment = loadDeployment();

  const contracts = {
    registry: new ethers.Contract(deployment.contracts.CareChainRegistry, loadAbi("CareChainRegistry"), provider),
    auditLog: new ethers.Contract(deployment.contracts.AuditLog, loadAbi("AuditLog"), provider),
    consentManager: new ethers.Contract(deployment.contracts.ConsentManager, loadAbi("ConsentManager"), provider),
    recordAnchor: new ethers.Contract(deployment.contracts.RecordAnchor, loadAbi("RecordAnchor"), provider),
    emergencyAccess: new ethers.Contract(
      deployment.contracts.EmergencyAccess,
      loadAbi("EmergencyAccess"),
      provider
    ),
  };

  return { provider, deployment, contracts, wallet: (i) => hardhatWallet(i, provider) };
}

module.exports = { connect, loadAbi, hardhatWallet, RPC_URL };
