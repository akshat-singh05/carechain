const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * Deploys the full CareChain contract set (Registry -> AuditLog ->
 * ConsentManager -> RecordAnchor -> EmergencyAccess), wires up the AuditLog
 * "authorized logger" role for the three contracts that need to write audit
 * entries, and writes the resulting addresses + ABIs to
 * backend/src/chain/deployment.json so the Express backend can pick them up
 * without any manual copy/paste.
 */
async function main() {
  const [admin] = await hre.ethers.getSigners();
  console.log("Deploying CareChain contracts with admin account:", admin.address);

  const Registry = await hre.ethers.getContractFactory("CareChainRegistry");
  const registry = await Registry.deploy(admin.address);
  await registry.waitForDeployment();

  const AuditLog = await hre.ethers.getContractFactory("AuditLog");
  const auditLog = await AuditLog.deploy(admin.address, await registry.getAddress());
  await auditLog.waitForDeployment();

  const ConsentManager = await hre.ethers.getContractFactory("ConsentManager");
  const consentManager = await ConsentManager.deploy(await registry.getAddress(), await auditLog.getAddress());
  await consentManager.waitForDeployment();

  const RecordAnchor = await hre.ethers.getContractFactory("RecordAnchor");
  const recordAnchor = await RecordAnchor.deploy(await registry.getAddress(), await auditLog.getAddress());
  await recordAnchor.waitForDeployment();

  const EmergencyAccess = await hre.ethers.getContractFactory("EmergencyAccess");
  const emergencyAccess = await EmergencyAccess.deploy(await registry.getAddress(), await auditLog.getAddress());
  await emergencyAccess.waitForDeployment();

  // Wire up which contracts may write to the shared audit log.
  await (await auditLog.authorizeLogger(await consentManager.getAddress())).wait();
  await (await auditLog.authorizeLogger(await recordAnchor.getAddress())).wait();
  await (await auditLog.authorizeLogger(await emergencyAccess.getAddress())).wait();

  const deployment = {
    network: hre.network.name,
    admin: admin.address,
    contracts: {
      CareChainRegistry: await registry.getAddress(),
      AuditLog: await auditLog.getAddress(),
      ConsentManager: await consentManager.getAddress(),
      RecordAnchor: await recordAnchor.getAddress(),
      EmergencyAccess: await emergencyAccess.getAddress(),
    },
  };

  const outDir = path.join(__dirname, "..", "backend", "src", "chain");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "deployment.json"), JSON.stringify(deployment, null, 2));

  console.log("Deployment complete:");
  console.log(JSON.stringify(deployment, null, 2));
  console.log(`Wrote ${path.join(outDir, "deployment.json")}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
