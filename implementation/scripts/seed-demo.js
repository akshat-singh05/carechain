const hre = require("hardhat");
const { ethers: ethersRoot } = require("ethers");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

/**
 * One-command local demo bootstrap (see README "Quick start"):
 *   1. Deploys the full CareChain contract set.
 *   2. Registers a small demo cast: two patients, a treating doctor, an
 *      emergency-responder doctor, and an auditor.
 *   3. Writes backend/src/chain/deployment.json (addresses) and
 *      backend/src/chain/users.json (demo login directory) so the Express
 *      backend can start immediately with working accounts.
 *
 * IMPORTANT: this derives private keys from Hardhat's well-known default
 * development mnemonic ("test test test test ... junk"), the same one
 * `npx hardhat node` uses for its first 20 accounts. These keys are public
 * knowledge and MUST NEVER be used outside a local Hardhat network. This is
 * a demo/dev convenience, not a real authentication design -- see the
 * "Security notes / prototype disclaimers" section of README.md.
 */
const DEV_MNEMONIC = "test test test test test test test test test test test junk";
const DEMO_PASSWORD = "password123";

function hardhatWallet(index) {
  return ethersRoot.HDNodeWallet.fromPhrase(DEV_MNEMONIC, undefined, `m/44'/60'/0'/0/${index}`);
}

async function main() {
  const [admin] = await hre.ethers.getSigners();

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

  await (await auditLog.authorizeLogger(await consentManager.getAddress())).wait();
  await (await auditLog.authorizeLogger(await recordAnchor.getAddress())).wait();
  await (await auditLog.authorizeLogger(await emergencyAccess.getAddress())).wait();

  const demoCast = [
    { index: 1, username: "patient1", role: "patient", metadataCid: "cid://patient1-profile" },
    { index: 2, username: "patient2", role: "patient", metadataCid: "cid://patient2-profile" },
    {
      index: 3,
      username: "doctor1",
      role: "provider",
      name: "Dr. Asha Rao",
      specialty: "Cardiology",
      organization: "General Hospital",
      isEmergencyResponder: false,
    },
    {
      index: 4,
      username: "erdoctor1",
      role: "provider",
      name: "Dr. Vikram Shah",
      specialty: "Emergency Medicine",
      organization: "General Hospital",
      isEmergencyResponder: true,
    },
    { index: 5, username: "auditor1", role: "auditor" },
    { index: 0, username: "admin", role: "admin" },
  ];

  const AUDITOR_ROLE = await registry.AUDITOR_ROLE();
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const users = [];

  for (const person of demoCast) {
    const wallet = hardhatWallet(person.index);

    if (person.role === "patient") {
      await (await registry.connect(admin).registerPatient(wallet.address, person.metadataCid)).wait();
    } else if (person.role === "provider") {
      await (
        await registry
          .connect(admin)
          .registerProvider(wallet.address, person.name, person.specialty, person.organization, person.isEmergencyResponder)
      ).wait();
    } else if (person.role === "auditor") {
      await (await registry.connect(admin).grantRole(AUDITOR_ROLE, wallet.address)).wait();
    }
    // "admin" role: accounts[0] already holds DEFAULT_ADMIN_ROLE / HOSPITAL_ADMIN_ROLE from the constructor.

    users.push({
      username: person.username,
      passwordHash,
      role: person.role,
      address: wallet.address,
      privateKey: wallet.privateKey,
    });
  }

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
  fs.writeFileSync(path.join(outDir, "users.json"), JSON.stringify({ demoPassword: DEMO_PASSWORD, users }, null, 2));

  console.log("Demo bootstrap complete.");
  console.log(`Deployed contracts -> ${path.join(outDir, "deployment.json")}`);
  console.log(`Demo users (all use password "${DEMO_PASSWORD}") -> ${path.join(outDir, "users.json")}`);
  console.table(users.map(({ username, role, address }) => ({ username, role, address })));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
