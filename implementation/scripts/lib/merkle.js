const { ethers } = require("ethers");
const { MerkleTree } = require("merkletreejs");
const keccak256 = require("keccak256");

/**
 * Shared Merkle-tree construction used by (a) the RecordAnchor unit tests,
 * (b) the anchoring-cost benchmark script in /experiments, and (c) the
 * backend's batching service. Keeping this in one place guarantees the leaf
 * encoding here always matches what RecordAnchor.sol's
 * `registerBatchRecord` recomputes on-chain:
 *
 *   leaf = keccak256(abi.encodePacked(recordId, patient, contentHash, cid))
 *
 * `sortPairs: true` matches OpenZeppelin's MerkleProof, which hashes each
 * pair in sorted order so proof verification does not depend on left/right
 * position.
 */
function leafFor({ recordId, patient, contentHash, cid }) {
  const packed = ethers.solidityPackedKeccak256(
    ["bytes32", "address", "bytes32", "string"],
    [recordId, patient, contentHash, cid]
  );
  return Buffer.from(packed.slice(2), "hex");
}

function buildTree(records) {
  const leaves = records.map(leafFor);
  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
  return { tree, leaves };
}

function getRoot(tree) {
  return "0x" + tree.getRoot().toString("hex");
}

function getProof(tree, leaf) {
  return tree.getHexProof(leaf);
}

module.exports = { leafFor, buildTree, getRoot, getProof };
