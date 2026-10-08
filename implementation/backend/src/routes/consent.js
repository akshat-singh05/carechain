const express = require("express");
const { ethers } = require("ethers");
const { requireAuth, requireRole } = require("../middleware/auth");
const { contractsWithSigner, getContracts } = require("../chain/contracts");
const { signerFor, findByAddress } = require("../services/users");

const { addressFields } = require("../middleware/validate");

const router = express.Router();

const ALL_RECORDS = ethers.ZeroHash;

/**
 * Grant time-bound, purpose-bound consent (PLAN.md contribution (b)).
 * Body: { providerAddress, recordId?, purpose?, validFrom?, validUntil }
 * recordId omitted/absent -> consent covers all of the patient's records.
 * purpose omitted -> consent covers any purpose.
 */
router.post("/grant", requireAuth, requireRole("patient"), addressFields("providerAddress"), async (req, res) => {
  try {
    const { providerAddress, recordId, purpose, validFrom, validUntil } = req.body || {};
    if (!providerAddress || !validUntil) {
      return res.status(400).json({ error: "providerAddress and validUntil are required" });
    }
    const scope = recordId || ALL_RECORDS;
    const from = validFrom || Math.floor(Date.now() / 1000);

    const user = findByAddress(req.user.address);
    const signer = signerFor(user);
    const { consentManager } = contractsWithSigner(signer);

    const tx = await consentManager.grantConsent(providerAddress, scope, purpose || "", from, validUntil);
    const receipt = await tx.wait();

    res.status(201).json({ txHash: receipt.hash, blockNumber: receipt.blockNumber });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:consentId/revoke", requireAuth, requireRole("patient"), async (req, res) => {
  try {
    const user = findByAddress(req.user.address);
    const signer = signerFor(user);
    const { consentManager } = contractsWithSigner(signer);

    const tx = await consentManager.revokeConsent(req.params.consentId);
    const receipt = await tx.wait();

    res.json({ txHash: receipt.hash });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/mine", requireAuth, requireRole("patient"), async (req, res) => {
  try {
    const { contracts } = getContracts();
    const ids = await contracts.consentManager.getPatientConsentIds(req.user.address);
    const consents = await Promise.all(
      ids.map(async (id) => {
        const c = await contracts.consentManager.getConsent(id);
        return {
          consentId: Number(id),
          provider: c.provider,
          recordScope: c.recordScope,
          validFrom: Number(c.validFrom),
          validUntil: Number(c.validUntil),
          revoked: c.revoked,
        };
      })
    );
    res.json({ consents });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
