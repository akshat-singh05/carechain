const { expect } = require("chai");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");
const { deployFixture } = require("./helpers");

const RECORD_A = ethers.keccak256(ethers.toUtf8Bytes("record-A"));
const RECORD_B = ethers.keccak256(ethers.toUtf8Bytes("record-B"));

describe("ConsentManager", function () {
  it("grants time-bound, purpose-bound consent and validates access within the window", async function () {
    const { consentManager, patient, provider } = await loadFixture(deployFixture);
    const now = await time.latest();
    const validFrom = now;
    const validUntil = now + 3600; // 1 hour

    await (
      await consentManager.connect(patient).grantConsent(provider.address, RECORD_A, "treatment", validFrom, validUntil)
    ).wait();

    expect(await consentManager.isConsentValid(patient.address, provider.address, RECORD_A, "treatment")).to.equal(
      true
    );
  });

  it("denies access for a purpose not covered by the consent", async function () {
    const { consentManager, patient, provider } = await loadFixture(deployFixture);
    const now = await time.latest();
    await (
      await consentManager
        .connect(patient)
        .grantConsent(provider.address, RECORD_A, "treatment", now, now + 3600)
    ).wait();

    expect(await consentManager.isConsentValid(patient.address, provider.address, RECORD_A, "billing")).to.equal(
      false
    );
  });

  it("denies access for a record outside the consent's scope", async function () {
    const { consentManager, patient, provider } = await loadFixture(deployFixture);
    const now = await time.latest();
    await (
      await consentManager
        .connect(patient)
        .grantConsent(provider.address, RECORD_A, "treatment", now, now + 3600)
    ).wait();

    expect(await consentManager.isConsentValid(patient.address, provider.address, RECORD_B, "treatment")).to.equal(
      false
    );
  });

  it("denies access once the consent has expired (time-bound enforcement)", async function () {
    const { consentManager, patient, provider } = await loadFixture(deployFixture);
    const now = await time.latest();
    const validUntil = now + 1000;
    await (
      await consentManager
        .connect(patient)
        .grantConsent(provider.address, RECORD_A, "treatment", now, validUntil)
    ).wait();

    await time.increaseTo(validUntil + 10);

    expect(await consentManager.isConsentValid(patient.address, provider.address, RECORD_A, "treatment")).to.equal(
      false
    );
  });

  it("denies access after the patient revokes consent", async function () {
    const { consentManager, patient, provider } = await loadFixture(deployFixture);
    const now = await time.latest();
    const consentId = await consentManager
      .connect(patient)
      .grantConsent.staticCall(provider.address, RECORD_A, "treatment", now, now + 3600);
    await (
      await consentManager.connect(patient).grantConsent(provider.address, RECORD_A, "treatment", now, now + 3600)
    ).wait();

    await (await consentManager.connect(patient).revokeConsent(consentId)).wait();

    expect(await consentManager.isConsentValid(patient.address, provider.address, RECORD_A, "treatment")).to.equal(
      false
    );
  });

  it("rejects an unregistered address as a consent grantee", async function () {
    const { consentManager, patient, outsider } = await loadFixture(deployFixture);
    const now = await time.latest();
    await expect(
      consentManager.connect(patient).grantConsent(outsider.address, RECORD_A, "treatment", now, now + 3600)
    ).to.be.revertedWith("ConsentManager: grantee is not a registered provider");
  });

  it("rejects a non-patient caller trying to grant consent", async function () {
    const { consentManager, provider, responder } = await loadFixture(deployFixture);
    const now = await time.latest();
    await expect(
      consentManager.connect(provider).grantConsent(responder.address, RECORD_A, "treatment", now, now + 3600)
    ).to.be.revertedWith("ConsentManager: caller is not a registered patient");
  });

  it("rejects revocation attempts from someone other than the granting patient", async function () {
    const { consentManager, patient, provider, outsider } = await loadFixture(deployFixture);
    const now = await time.latest();
    const consentId = await consentManager
      .connect(patient)
      .grantConsent.staticCall(provider.address, RECORD_A, "treatment", now, now + 3600);
    await (
      await consentManager.connect(patient).grantConsent(provider.address, RECORD_A, "treatment", now, now + 3600)
    ).wait();

    await expect(consentManager.connect(outsider).revokeConsent(consentId)).to.be.revertedWith(
      "ConsentManager: only the granting patient may revoke"
    );
  });

  it("checkAndLogAccess writes an ACCESS_GRANTED audit entry on success and ACCESS_DENIED on failure", async function () {
    const { consentManager, auditLog, patient, provider, outsider } = await loadFixture(deployFixture);
    const now = await time.latest();
    await (
      await consentManager
        .connect(patient)
        .grantConsent(provider.address, RECORD_A, "treatment", now, now + 3600)
    ).wait();

    await (await consentManager.connect(provider).checkAndLogAccess(patient.address, RECORD_A, "treatment")).wait();
    await (await consentManager.connect(outsider).checkAndLogAccess(patient.address, RECORD_A, "treatment")).wait();

    const total = await auditLog.totalEntries();
    // 1 CONSENT_GRANTED + 1 ACCESS_GRANTED + 1 ACCESS_DENIED = 3
    expect(total).to.equal(3n);

    const granted = await auditLog.getEntry(1);
    const denied = await auditLog.getEntry(2);
    expect(granted.action).to.equal(4); // ACCESS_GRANTED
    expect(denied.action).to.equal(5); // ACCESS_DENIED
  });
});
