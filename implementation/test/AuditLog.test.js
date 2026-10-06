const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");
const { deployFixture } = require("./helpers");

const RECORD_A = ethers.keccak256(ethers.toUtf8Bytes("record-A"));

describe("AuditLog", function () {
  it("rejects append() from a contract/account that was never authorized as a logger", async function () {
    const { auditLog, provider, patient } = await loadFixture(deployFixture);
    await expect(
      auditLog.connect(provider).append(provider.address, patient.address, RECORD_A, 0, "purpose", false)
    ).to.be.reverted;
  });

  it("lets the patient themselves read their own audit trail", async function () {
    const { consentManager, auditLog, patient, provider } = await loadFixture(deployFixture);
    const now = Math.floor(Date.now() / 1000);
    await (
      await consentManager.connect(patient).grantConsent(provider.address, RECORD_A, "treatment", now, now + 3600)
    ).wait();

    const trail = await auditLog.connect(patient).getPatientTrail(patient.address);
    expect(trail.length).to.be.greaterThan(0);
  });

  it("lets a registered auditor read any patient's audit trail", async function () {
    const { consentManager, auditLog, patient, provider, auditorSigner } = await loadFixture(deployFixture);
    const now = Math.floor(Date.now() / 1000);
    await (
      await consentManager.connect(patient).grantConsent(provider.address, RECORD_A, "treatment", now, now + 3600)
    ).wait();

    const trail = await auditLog.connect(auditorSigner).getPatientTrail(patient.address);
    expect(trail.length).to.be.greaterThan(0);
  });

  it("rejects an arbitrary provider trying to read a patient's audit trail", async function () {
    const { auditLog, patient, provider } = await loadFixture(deployFixture);
    await expect(auditLog.connect(provider).getPatientTrail(patient.address)).to.be.revertedWith(
      "AuditLog: not authorized to view this trail"
    );
  });
});
