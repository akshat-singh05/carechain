const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { deployFixture } = require("./helpers");

describe("CareChainRegistry", function () {
  it("registers a patient and grants PATIENT_ROLE", async function () {
    const { registry, patient } = await loadFixture(deployFixture);
    expect(await registry.isPatient(patient.address)).to.equal(true);
    const record = await registry.getPatient(patient.address);
    expect(record.registered).to.equal(true);
    expect(record.metadataCid).to.equal("cid://patient-profile-1");
  });

  it("registers a provider and grants PROVIDER_ROLE but not EMERGENCY_RESPONDER_ROLE unless requested", async function () {
    const { registry, provider, responder } = await loadFixture(deployFixture);
    expect(await registry.isProvider(provider.address)).to.equal(true);
    expect(await registry.isEmergencyResponder(provider.address)).to.equal(false);
    expect(await registry.isEmergencyResponder(responder.address)).to.equal(true);
  });

  it("rejects double-registration of the same patient", async function () {
    const { registry, admin, patient } = await loadFixture(deployFixture);
    await expect(
      registry.connect(admin).registerPatient(patient.address, "cid://duplicate")
    ).to.be.revertedWith("CareChainRegistry: patient already registered");
  });

  it("rejects a non-admin trying to register a patient", async function () {
    const { registry, provider, outsider } = await loadFixture(deployFixture);
    await expect(
      registry.connect(provider).registerPatient(outsider.address, "cid://x")
    ).to.be.reverted;
  });

  it("deactivating a provider revokes both PROVIDER_ROLE and EMERGENCY_RESPONDER_ROLE", async function () {
    const { registry, admin, responder } = await loadFixture(deployFixture);
    await (await registry.connect(admin).deactivateProvider(responder.address)).wait();
    expect(await registry.isProvider(responder.address)).to.equal(false);
    expect(await registry.isEmergencyResponder(responder.address)).to.equal(false);
  });
});
