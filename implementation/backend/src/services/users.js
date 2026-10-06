const fs = require("fs");
const { ethers } = require("ethers");
const config = require("../config");
const { getContracts } = require("../chain/contracts");

/**
 * Demo user directory backed by backend/src/chain/users.json (produced by
 * `npm run seed:local`). Role/identity here is deliberately simple -- a
 * lookup table mapping a login to a blockchain address + private key --
 * because the paper's contribution is the consent/audit/anchoring design,
 * not a novel identity system. In a Fabric deployment this role would be
 * played by MSP-issued client certificates; the trade-off is stated in
 * PLAN.md Section 3.
 */
function loadUsers() {
  if (!fs.existsSync(config.usersPath)) {
    throw new Error(`Missing ${config.usersPath}. Run "npm run seed:local" first.`);
  }
  return JSON.parse(fs.readFileSync(config.usersPath, "utf8")).users;
}

function findByUsername(username) {
  return loadUsers().find((u) => u.username === username);
}

function findByAddress(address) {
  return loadUsers().find((u) => u.address.toLowerCase() === address.toLowerCase());
}

// A fresh Wallet per request re-queries the "pending" nonce, which on an
// automining node can still be stale right after the previous tx was mined
// ("nonce has already been used"). One long-lived NonceManager per user
// tracks the nonce locally instead. NonceManager increments before the send
// is validated, so a reverted/failed send would leave a gap; reset on any
// failure so the next call re-reads the chain.
class ResyncingNonceManager extends ethers.NonceManager {
  async sendTransaction(tx) {
    try {
      return await super.sendTransaction(tx);
    } catch (err) {
      this.reset();
      throw err;
    }
  }
}

const signerCache = new Map();

function signerFor(user) {
  const key = user.address.toLowerCase();
  if (!signerCache.has(key)) {
    const { provider } = getContracts();
    signerCache.set(key, new ResyncingNonceManager(new ethers.Wallet(user.privateKey, provider)));
  }
  return signerCache.get(key);
}

module.exports = { loadUsers, findByUsername, findByAddress, signerFor };
