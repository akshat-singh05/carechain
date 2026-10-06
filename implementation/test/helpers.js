const hre = require("hardhat");

/**
 * Deploys the full CareChain contract set and registers a small standard
 * cast of actors used across the test suite:
 *   admin      - hospital admin (DEFAULT_ADMIN_ROLE / HOSPITAL_ADMIN_ROLE)
 *   patient    - registered patient
 *   provider   - registered provider (not an emergency responder)
 *   responder  - registered provider WITH the EMERGENCY_RESPONDER_ROLE
 *   outsider   - an address registered as nothing at all
 *   auditor    - registered as AUDITOR_ROLE
 */
async function deployFixture() {
  const [admin, patient, provider, responder, outsider, auditorSigner] = await hre.ethers.getSigners();

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

  await (await registry.connect(admin).registerPatient(patient.address, "cid://patient-profile-1")).wait();
  await (
    await registry
      .connect(admin)
      .registerProvider(provider.address, "Dr. Provider", "Cardiology", "General Hospital", false)
  ).wait();
  await (
    await registry
      .connect(admin)
      .registerProvider(responder.address, "Dr. Responder", "Emergency Medicine", "General Hospital", true)
  ).wait();

  const AUDITOR_ROLE = await registry.AUDITOR_ROLE();
  await (await registry.connect(admin).grantRole(AUDITOR_ROLE, auditorSigner.address)).wait();

  return {
    admin,
    patient,
    provider,
    responder,
    outsider,
    auditorSigner,
    registry,
    auditLog,
    consentManager,
    recordAnchor,
    emergencyAccess,
  };
}

module.exports = { deployFixture };
