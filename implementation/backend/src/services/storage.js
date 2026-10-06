const fs = require("fs");
const path = require("path");
const config = require("../config");
const { sha256Hex } = require("./crypto");

fs.mkdirSync(config.storageDir, { recursive: true });

/**
 * Minimal local content-addressed store, standing in for IPFS as discussed
 * in PLAN.md Section 3. `put` returns a "cid" that is really just
 * `local://<sha256-of-ciphertext>` -- addressing-compatible with the idea of
 * a CID (content determines the address, so tampering is self-evident) but
 * NOT a real distributed IPFS network. If a real Kubo/IPFS daemon is
 * available, this module is the only place that needs to change (swap
 * put/get for an ipfs-http-client call) -- everything upstream only depends
 * on the {cid, contentHash} shape returned here.
 */
function put(blob) {
  const hash = sha256Hex(blob);
  const filePath = path.join(config.storageDir, hash);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, blob);
  }
  return { cid: `local://${hash}`, contentHashHex: hash };
}

function get(cid) {
  const hash = cid.startsWith("local://") ? cid.slice("local://".length) : cid;
  const filePath = path.join(config.storageDir, hash);
  if (!fs.existsSync(filePath)) {
    throw new Error(`storage: no blob found for cid ${cid}`);
  }
  return fs.readFileSync(filePath);
}

module.exports = { put, get };
