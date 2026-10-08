const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { contractsWithSigner } = require("../chain/contracts");
const { signerFor, findByAddress } = require("../services/users");

const { validateAddressParam } = require("../middleware/validate");

const router = express.Router();
router.param("patientAddress", validateAddressParam);

const ACTION_NAMES = [
  "RECORD_ANCHORED",
  "BATCH_ANCHORED",
  "CONSENT_GRANTED",
  "CONSENT_REVOKED",
  "ACCESS_GRANTED",
  "ACCESS_DENIED",
  "EMERGENCY_ACCESS",
];

/**
 * Audit view (PLAN.md Phase 1: "an audit view" frontend flow). AuditLog.sol
 * itself gates `getPatientTrail` to the patient, a registered auditor, or a
 * hospital admin -- this route just surfaces that same on-chain check
 * through the API, connecting the call with the *caller's own* signer so
 * the contract's msg.sender-based authorization is what actually decides
 * access, not an application-layer role string alone.
 */
router.get("/:patientAddress", requireAuth, async (req, res) => {
  try {
    const user = findByAddress(req.user.address);
    const signer = signerFor(user);
    const { auditLog } = contractsWithSigner(signer);

    const entryIds = await auditLog.getPatientTrail(req.params.patientAddress);
    const entries = await Promise.all(
      entryIds.map(async (id) => {
        const e = await auditLog.getEntry(id);
        return {
          entryId: Number(id),
          actor: e.actor,
          patient: e.patient,
          recordId: e.recordId,
          action: ACTION_NAMES[Number(e.action)],
          purpose: e.purpose,
          timestamp: Number(e.timestamp),
          isEmergency: e.isEmergency,
        };
      })
    );

    res.json({ entries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
