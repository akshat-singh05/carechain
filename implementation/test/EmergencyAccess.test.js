const { expect } = require("chai");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");
const { deployFixture } = require("./helpers");

const RECORD_A = ethers.keccak256(ethers.toUtf8Bytes("record-A"));

describe("EmergencyAccess", function () {
  it("grants break-glass access, sets pendingNotification, and writes an isEmergency audit entry", async function () {
    const { emergencyAccess, auditLog, responder, patient } = await loadFixture(deployFixture);

    await (
      await emergencyAccess.connect(responder).emergencyAccess(patient.address, RECORD_A, "unresponsive patient, ER intake")
    ).wait();

    expect(await emergencyAccess.pendingNotification(patient.address)).to.equal(true);

    const total = await auditLog.totalEntries();
    const entry = await auditLog.getEntry(total - 1n);
    expect(entry.isEmergency).to.equal(true);
    expect(entry.action).to.equal(6); // EMERGENCY_ACCESS
  });

  it("exposes each emergency event (responder, patient, reason, notified) via getEmergencyEvent", async function () {
    const { emergencyAccess, responder, patient } = await loadFixture(deployFixture);
    await (await emergencyAccess.connect(responder).emergencyAccess(patient.address, RECORD_A, "cardiac arrest")).wait();

    const ids = await emergencyAccess.getPatientEventIds(patient.address);
    expect(ids.length).to.equal(1);
    const e = await emergencyAccess.getEmergencyEvent(ids[0]);
    expect(e.responder).to.equal(responder.address);
    expect(e.patient).to.equal(patient.address);
    expect(e.reason).to.equal("cardiac arrest");
    expect(e.notified).to.equal(false);
  });

  it("rejects break-glass access from a provider who is not a credentialed emergency responder", async function () {
    const { emergencyAccess, provider, patient } = await loadFixture(deployFixture);
    await expect(
      emergencyAccess.connect(provider).emergencyAccess(patient.address, RECORD_A, "reason")
    ).to.be.revertedWith("EmergencyAccess: caller is not a credentialed emergency responder");
  });

  it("requires a non-empty reason so every emergency call is auditable", async function () {
    const { emergencyAccess, responder, patient } = await loadFixture(deployFixture);
    await expect(
      emergencyAccess.connect(responder).emergencyAccess(patient.address, RECORD_A, "")
    ).to.be.revertedWith("EmergencyAccess: a reason is required for the audit record");
  });

  it("enforces the daily per-responder rate limit (MAX_EMERGENCY_PER_DAY)", async function () {
    const { emergencyAccess, responder, patient } = await loadFixture(deployFixture);
    const max = await emergencyAccess.MAX_EMERGENCY_PER_DAY();

    for (let i = 0; i < Number(max); i++) {
      await (
        await emergencyAccess.connect(responder).emergencyAccess(patient.address, RECORD_A, `reason-${i}`)
      ).wait();
    }

    await expect(
      emergencyAccess.connect(responder).emergencyAccess(patient.address, RECORD_A, "one-too-many")
    ).to.be.revertedWith("EmergencyAccess: responder exceeded daily emergency-access limit");

    // After the rate-limit window passes, the responder can use break-glass again.
    await time.increase(24 * 3600 + 1);
    await expect(
      emergencyAccess.connect(responder).emergencyAccess(patient.address, RECORD_A, "after-window")
    ).to.not.be.reverted;
  });

  it("only a hospital admin (backend service account) can mark an event as notified, and clears pendingNotification once all events are notified", async function () {
    const { emergencyAccess, admin, responder, provider, patient } = await loadFixture(deployFixture);
    await (
      await emergencyAccess.connect(responder).emergencyAccess(patient.address, RECORD_A, "reason")
    ).wait();

    await expect(emergencyAccess.connect(provider).markNotified(patient.address, 0)).to.be.revertedWith(
      "EmergencyAccess: only a hospital admin (backend service account) may confirm notification"
    );

    await (await emergencyAccess.connect(admin).markNotified(patient.address, 0)).wait();
    expect(await emergencyAccess.pendingNotification(patient.address)).to.equal(false);
  });
});
