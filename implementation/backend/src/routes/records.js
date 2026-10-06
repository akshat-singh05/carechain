const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const { ethers } = require("ethers");
const { requireAuth, requireRole } = require("../middleware/auth");
const { contractsWithSigner, getContracts } = require("../chain/contracts");
const { signerFor, findByAddress } = require("../services/users");
const { encryptRecord, decryptRecord } = require("../services/crypto");
const storage = require("../services/storage");
const keystore = require("../services/keystore");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

function newRecordId() {
  return ethers.hexlify(crypto.randomBytes(32));
}

/**
 * Upload flow (Section "Record upload and hash anchoring" sequence diagram):
 * client -> backend: multipart file + patientAddress
 * backend: AES-256-GCM encrypt -> local content-addressed store -> wrap data
 * key in keystore -> anchorRecord(recordId, patient, sha256(ciphertext), cid)
 * on-chain via the uploading provider's own signer (so msg.sender in the
 * contract really is the authenticated provider, not a shared backend key).
 */
router.post("/upload", requireAuth, requireRole("provider"), upload.single("file"), async (req, res) => {
  try {
    const { patientAddress } = req.body;
    if (!req.file) return res.status(400).json({ error: "file is required (multipart field 'file')" });
    if (!patientAddress) return res.status(400).json({ error: "patientAddress is required" });

    const { blob, key } = encryptRecord(req.file.buffer);
    const { cid, contentHashHex } = storage.put(blob);
    const recordId = newRecordId();
    keystore.wrapAndStore(recordId, key);

    const user = findByAddress(req.user.address);
    const signer = signerFor(user);
    const { recordAnchor } = contractsWithSigner(signer);

    const tx = await recordAnchor.anchorRecord(recordId, patientAddress, "0x" + contentHashHex, cid);
    const receipt = await tx.wait();

    res.status(201).json({
      recordId,
      cid,
      contentHash: "0x" + contentHashHex,
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Metadata only -- never returns decrypted content. */
router.get("/:recordId/meta", requireAuth, async (req, res) => {
  try {
    const { contracts } = getContracts();
    const meta = await contracts.recordAnchor.getRecord(req.params.recordId);
    if (meta.timestamp === 0n) return res.status(404).json({ error: "record not found" });

    res.json({
      recordId: req.params.recordId,
      contentHash: meta.contentHash,
      cid: meta.cid,
      uploader: meta.uploader,
      patient: meta.patient,
      timestamp: Number(meta.timestamp),
      anchoredInBatch: meta.anchoredInBatch,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Decrypted content. This is the route that actually enforces
 * PLAN.md's ABAC consent contribution: a patient may always read their own
 * record; a provider must pass ConsentManager.checkAndLogAccess (which
 * itself re-checks time/purpose bounds on-chain and writes the audit entry)
 * before the backend will decrypt anything.
 */
router.get("/:recordId/content", requireAuth, async (req, res) => {
  try {
    const { recordId } = req.params;
    const purpose = req.query.purpose || "treatment";
    const { contracts } = getContracts();
    const meta = await contracts.recordAnchor.getRecord(recordId);
    if (meta.timestamp === 0n) return res.status(404).json({ error: "record not found" });

    const requester = findByAddress(req.user.address);
    let authorized = false;

    if (req.user.role === "patient" && meta.patient.toLowerCase() === req.user.address.toLowerCase()) {
      authorized = true;
    } else if (req.user.role === "provider") {
      const signer = signerFor(requester);
      const { consentManager } = contractsWithSigner(signer);
      const tx = await consentManager.checkAndLogAccess(meta.patient, recordId, purpose);
      const receipt = await tx.wait();
      authorized = await contracts.consentManager.isConsentValid(meta.patient, req.user.address, recordId, purpose);
      if (!authorized) {
        return res.status(403).json({ error: "Access denied: no valid consent for this record/purpose", txHash: receipt.hash });
      }
    } else if (req.user.role === "admin" || req.user.role === "auditor") {
      return res.status(403).json({ error: "Auditors/admins may view the audit trail, not decrypted record content" });
    }

    if (!authorized) return res.status(403).json({ error: "Access denied" });

    const key = keystore.unwrap(recordId);
    const blob = storage.get(meta.cid);
    const plaintext = decryptRecord(blob, key);

    res.setHeader("Content-Type", "application/octet-stream");
    res.send(plaintext);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/patient/:patientAddress", requireAuth, async (req, res) => {
  try {
    const { contracts } = getContracts();
    const ids = await contracts.recordAnchor.getPatientRecordIds(req.params.patientAddress);
    res.json({ recordIds: ids });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
