const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const config = require("../config");

const MASTER_KEY_PATH = path.join(config.storageDir, ".master.key");
const KEYSTORE_PATH = path.join(config.storageDir, ".keystore.json");

/**
 * Server-held keystore for per-record AES data keys, wrapped (encrypted) at
 * rest under a single server master key.
 *
 * HONEST LIMITATION (see PLAN.md Section 2, why we did not pick contribution
 * (e)): this is a centralized key-custody model, not proxy re-encryption or
 * per-patient client-held keys. The server that runs this process can
 * decrypt every record. That is an explicit, disclosed trade-off, discussed
 * in the paper's Discussion/Limitations section -- not a hidden gap. A
 * production system would replace this module with either patient-held keys
 * (requiring a client-side crypto UI) or a proxy re-encryption scheme.
 */
function loadOrCreateMasterKey() {
  if (fs.existsSync(MASTER_KEY_PATH)) {
    return fs.readFileSync(MASTER_KEY_PATH);
  }
  const key = crypto.randomBytes(32);
  fs.mkdirSync(config.storageDir, { recursive: true });
  fs.writeFileSync(MASTER_KEY_PATH, key);
  return key;
}

function loadKeystore() {
  if (!fs.existsSync(KEYSTORE_PATH)) return {};
  return JSON.parse(fs.readFileSync(KEYSTORE_PATH, "utf8"));
}

function saveKeystore(store) {
  fs.writeFileSync(KEYSTORE_PATH, JSON.stringify(store, null, 2));
}

function wrapAndStore(recordId, dataKey) {
  const masterKey = loadOrCreateMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey, iv);
  const wrapped = Buffer.concat([cipher.update(dataKey), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const store = loadKeystore();
  store[recordId] = {
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
    wrappedKey: wrapped.toString("hex"),
  };
  saveKeystore(store);
}

function unwrap(recordId) {
  const masterKey = loadOrCreateMasterKey();
  const store = loadKeystore();
  const entry = store[recordId];
  if (!entry) throw new Error(`keystore: no data key found for record ${recordId}`);

  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey, Buffer.from(entry.iv, "hex"));
  decipher.setAuthTag(Buffer.from(entry.authTag, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(entry.wrappedKey, "hex")), decipher.final()]);
}

module.exports = { wrapAndStore, unwrap };
