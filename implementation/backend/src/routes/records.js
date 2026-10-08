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
const { buildTree, getRoot, getProof } = require("../../../scripts/lib/merkle");

const { addressFields, validateAddressParam } = require("../middleware/validate");

const { friendlyError } = require("../services/errors");

const router = express.Router();
router.param("patientAddress", validateAddressParam);
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
router.post("/upload", requireAuth, requireRole("provider"), upload.single("file"), addressFields("patientAddress"), async (req, res) => {
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
    res.status(500).json({ error: friendlyError(err) });
  }
});

/**
 * Merkle-batched upload (contribution (d)): encrypts every file, builds one
 * Merkle tree over all records, and anchors ONLY the root with a single
 * anchorBatch transaction. A manifest listing every leaf is stored off-chain.
 * Per-record proofs are returned so inclusion can be verified later with
 * RecordAnchor.verifyInclusion. By default each record is also registered
 * on-chain (registerBatchRecord) so the normal /records/:id/content route works;
 * pass register=false to skip that per-record cost (the lazy mode the paper
 * measures) -- those records are then provable but not readable via the API.
 */
router.post("/upload-batch", requireAuth, requireRole("provider"), upload.array("files", 100), addressFields("patientAddress"), async (req, res) => {
  try {
    const { patientAddress } = req.body;
    const register = req.body.register !== "false";
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: "files are required (multipart field 'files')" });
    if (!patientAddress) return res.status(400).json({ error: "patientAddress is required" });

    const records = req.files.map((f) => {
      const { blob, key } = encryptRecord(f.buffer);
      const { cid, contentHashHex } = storage.put(blob);
      const recordId = newRecordId();
      keystore.wrapAndStore(recordId, key);
      return { recordId, patient: patientAddress, contentHash: "0x" + contentHashHex, cid };
    });

    const { tree, leaves } = buildTree(records);
    const merkleRoot = getRoot(tree);
    const proofs = leaves.map((leaf) => getProof(tree, leaf));
    const manifest = storage.put(
      Buffer.from(JSON.stringify({ merkleRoot, records: records.map((r, i) => ({ ...r, proof: proofs[i] })) }))
    );

    const signer = signerFor(findByAddress(req.user.address));
    const { recordAnchor } = contractsWithSigner(signer);
    const tx = await recordAnchor.anchorBatch(merkleRoot, records.length, manifest.cid);
    const receipt = await tx.wait();
    const batchId = Number((await getContracts().contracts.recordAnchor.totalBatches()) - 1n);

    if (register) {
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        await (await recordAnchor.registerBatchRecord(batchId, r.recordId, r.patient, r.contentHash, r.cid, proofs[i])).wait();
      }
    }

    res.status(201).json({
      batchId,
      merkleRoot,
      manifestCid: manifest.cid,
      anchorTxHash: receipt.hash,
      registered: register,
      records: records.map((r, i) => ({ recordId: r.recordId, cid: r.cid, contentHash: r.contentHash, proof: proofs[i] })),
    });
  } catch (err) {
    res.status(500).json({ error: friendlyError(err) });
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
    res.status(500).json({ error: friendlyError(err) });
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
    res.status(500).json({ error: friendlyError(err) });
  }
});

router.get("/patient/:patientAddress", requireAuth, async (req, res) => {
  try {
    const { contracts } = getContracts();
    const ids = await contracts.recordAnchor.getPatientRecordIds(req.params.patientAddress);
    res.json({ recordIds: ids });
  } catch (err) {
    res.status(500).json({ error: friendlyError(err) });
  }
});

module.exports = router;
