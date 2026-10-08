const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const { contractsWithSigner } = require("../chain/contracts");
const { signerFor, findByAddress } = require("../services/users");

const { addressFields } = require("../middleware/validate");

const { friendlyError } = require("../services/errors");

const router = express.Router();

/**
 * "Doctor access request and verification" flow (PLAN.md Phase 3, figure 5):
 * a provider asks, for a given patient/record/purpose, whether they
 * currently have valid consent. This performs the SAME on-chain ABAC check
 * used by GET /records/:id/content, but does not return record content --
 * it is meant for a UI step where the doctor checks access before
 * attempting to open a record (and produces its own ACCESS_GRANTED /
 * ACCESS_DENIED audit entry, independent of any later content fetch).
 */
router.post("/request", requireAuth, requireRole("provider"), addressFields("patientAddress"), async (req, res) => {
  try {
    const { patientAddress, recordId, purpose } = req.body || {};
    if (!patientAddress || !recordId) {
      return res.status(400).json({ error: "patientAddress and recordId are required" });
    }

    const user = findByAddress(req.user.address);
    const signer = signerFor(user);
    const { consentManager } = contractsWithSigner(signer);

    const tx = await consentManager.checkAndLogAccess(patientAddress, recordId, purpose || "treatment");
    const receipt = await tx.wait();

    const granted = await consentManager.isConsentValid(patientAddress, req.user.address, recordId, purpose || "treatment");

    res.json({ granted, txHash: receipt.hash, blockNumber: receipt.blockNumber });
  } catch (err) {
    res.status(500).json({ error: friendlyError(err) });
  }
});

module.exports = router;
