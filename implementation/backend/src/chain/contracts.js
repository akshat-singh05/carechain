const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const config = require("../config");

function loadAbi(contractName) {
  const abiPath = path.join(config.artifactsDir, `${contractName}.sol`, `${contractName}.json`);
  if (!fs.existsSync(abiPath)) {
    throw new Error(
      `Missing compiled artifact for ${contractName} at ${abiPath}. Run "npm run compile" first.`
    );
  }
  return JSON.parse(fs.readFileSync(abiPath, "utf8")).abi;
}

function loadDeployment() {
  if (!fs.existsSync(config.deploymentPath)) {
    throw new Error(
      `Missing ${config.deploymentPath}. Run "npx hardhat node" in one terminal, then ` +
        `"npm run seed:local" in another before starting the backend.`
    );
  }
  return JSON.parse(fs.readFileSync(config.deploymentPath, "utf8"));
}

let cached = null;

/**
 * Returns { provider, contracts: { registry, auditLog, consentManager,
 * recordAnchor, emergencyAccess } } (read-only instances). Writes must be
 * made through a signer-connected copy -- see `contractsWithSigner`.
 */
function getContracts() {
  if (cached) return cached;

  const deployment = loadDeployment();
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);

  const contracts = {
    registry: new ethers.Contract(deployment.contracts.CareChainRegistry, loadAbi("CareChainRegistry"), provider),
    auditLog: new ethers.Contract(deployment.contracts.AuditLog, loadAbi("AuditLog"), provider),
    consentManager: new ethers.Contract(deployment.contracts.ConsentManager, loadAbi("ConsentManager"), provider),
    recordAnchor: new ethers.Contract(deployment.contracts.RecordAnchor, loadAbi("RecordAnchor"), provider),
    emergencyAccess: new ethers.Contract(deployment.contracts.EmergencyAccess, loadAbi("EmergencyAccess"), provider),
  };

  cached = { provider, contracts, deployment };
  return cached;
}

/** Returns the same five contracts, connected to `signer` for state-changing calls. */
function contractsWithSigner(signer) {
  const { contracts } = getContracts();
  return {
    registry: contracts.registry.connect(signer),
    auditLog: contracts.auditLog.connect(signer),
    consentManager: contracts.consentManager.connect(signer),
    recordAnchor: contracts.recordAnchor.connect(signer),
    emergencyAccess: contracts.emergencyAccess.connect(signer),
  };
}

module.exports = { getContracts, contractsWithSigner };
