const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const { contractsWithSigner, getContracts } = require("../chain/contracts");
const { signerFor, findByAddress, loadUsers } = require("../services/users");
const { decryptRecord } = require("../services/crypto");
const storage = require("../services/storage");
const keystore = require("../services/keystore");

const router = express.Router();

/**
 * Break-glass emergency access (PLAN.md contribution (c)). The contract
 * (EmergencyAccess.sol) enforces the three mandatory properties: an
 * isEmergency=true audit entry, a pendingNotification flag flip, and a
 * per-responder daily rate limit. This route additionally:
 *   1. Simulates delivering a patient notification (no real email/SMS
 *      provider is wired up in this prototype -- logged instead, clearly
 *      labeled as simulated) and then calls markNotified using the hospital
 *      admin's signer, exactly mirroring how a real notification service
 *      would confirm delivery back to the chain.
 *   2. Immediately decrypts and returns the record content, since the whole
 *      point of break-glass is that the responder does not wait for a
 *      normal consent grant.
 */
router.post("/access", requireAuth, requireRole("provider"), async (req, res) => {
  try {
    const { patientAddress, recordId, reason } = req.body || {};
    if (!patientAddress || !recordId || !reason) {
      return res.status(400).json({ error: "patientAddress, recordId and reason are all required" });
    }

    const responder = findByAddress(req.user.address);
    const responderSigner = signerFor(responder);
    const { emergencyAccess } = contractsWithSigner(responderSigner);

    const tx = await emergencyAccess.emergencyAccess(patientAddress, recordId, reason);
    const receipt = await tx.wait();

    const eventLog = receipt.logs
      .map((log) => {
        try {
          return emergencyAccess.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed && parsed.name === "EmergencyAccessGranted");
    const eventId = eventLog ? Number(eventLog.args.eventId) : null;

    // --- Simulated notification delivery ---
    console.log(
      `[SIMULATED NOTIFICATION] Patient ${patientAddress} would be notified now: ` +
        `Dr. ${responder.username} accessed record ${recordId} under emergency ("break-glass") access. Reason: "${reason}".`
    );

    const admin = loadUsers().find((u) => u.role === "admin");
    const adminSigner = signerFor(admin);
    const { emergencyAccess: emergencyAsAdmin } = contractsWithSigner(adminSigner);
    if (eventId !== null) {
      await (await emergencyAsAdmin.markNotified(patientAddress, eventId)).wait();
    }

    const { contracts } = getContracts();
    const meta = await contracts.recordAnchor.getRecord(recordId);
    let content = null;
    if (meta.timestamp !== 0n) {
      const key = keystore.unwrap(recordId);
      const blob = storage.get(meta.cid);
      content = decryptRecord(blob, key).toString("base64");
    }

    res.json({
      eventId,
      txHash: receipt.hash,
      notified: eventId !== null,
      recordContentBase64: content,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/pending/:patientAddress", requireAuth, async (req, res) => {
  try {
    const { contracts } = getContracts();
    const pending = await contracts.emergencyAccess.pendingNotification(req.params.patientAddress);
    const eventIds = await contracts.emergencyAccess.getPatientEventIds(req.params.patientAddress);
    const events = await Promise.all(
      eventIds.map(async (id) => {
        const e = await contracts.emergencyAccess.getEmergencyEvent(id);
        return {
          eventId: Number(id),
          responder: e.responder,
          recordId: e.recordId,
          reason: e.reason,
          timestamp: Number(e.timestamp),
          notified: e.notified,
        };
      })
    );
    res.json({ pendingNotification: pending, events });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
