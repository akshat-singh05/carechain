const crypto = require("crypto");

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit nonce, recommended for GCM

/**
 * Envelope encryption for record contents (PLAN.md Section 3): every record
 * is encrypted client-side-equivalent (here: at the API boundary, before it
 * ever touches the storage layer) with a fresh random AES-256-GCM key/nonce.
 * Only the resulting ciphertext + auth tag + nonce are ever written to
 * storage; only the SHA-256 hash of that ciphertext is ever anchored
 * on-chain. The data key itself is returned to the caller so the backend
 * can wrap/store it per-patient (see services/keystore.js) rather than
 * embedding it in the ciphertext blob.
 */
function encryptRecord(plaintextBuffer) {
  const key = crypto.randomBytes(32); // AES-256 key
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintextBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Storage layout: [iv (12B)][authTag (16B)][ciphertext...]
  const blob = Buffer.concat([iv, authTag, ciphertext]);
  return { blob, key };
}

function decryptRecord(blob, key) {
  const iv = blob.subarray(0, IV_LENGTH);
  const authTag = blob.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = blob.subarray(IV_LENGTH + 16);

  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

module.exports = { encryptRecord, decryptRecord, sha256Hex };
