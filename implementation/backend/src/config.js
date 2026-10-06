require("dotenv").config();
const path = require("path");

module.exports = {
  port: process.env.PORT || 4000,
  rpcUrl: process.env.RPC_URL || "http://127.0.0.1:8545",
  jwtSecret: process.env.JWT_SECRET || "dev-only-secret-change-me",
  jwtExpiresIn: "8h",
  // Local content-addressed storage: the stand-in for IPFS described in
  // PLAN.md Section 3. Every file is written under its own SHA-256 hash, so
  // it behaves like a minimal, single-node IPFS in terms of addressing
  // semantics, but it is NOT a distributed content-addressed network.
  storageDir: path.join(__dirname, "..", "storage"),
  deploymentPath: path.join(__dirname, "chain", "deployment.json"),
  usersPath: path.join(__dirname, "chain", "users.json"),
  artifactsDir: path.join(__dirname, "..", "..", "artifacts", "contracts"),
};
