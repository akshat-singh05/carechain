const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");
const { deployFixture } = require("./helpers");
const { buildTree, getRoot, getProof, leafFor } = require("../scripts/lib/merkle");

const RECORD_A = ethers.keccak256(ethers.toUtf8Bytes("record-A"));
const CONTENT_HASH_A = ethers.keccak256(ethers.toUtf8Bytes("ciphertext-A"));

describe("RecordAnchor", function () {
  it("anchors an individual record and stores retrievable metadata", async function () {
    const { recordAnchor, provider, patient } = await loadFixture(deployFixture);
    await (
      await recordAnchor.connect(provider).anchorRecord(RECORD_A, patient.address, CONTENT_HASH_A, "cid://record-A")
    ).wait();

    const meta = await recordAnchor.getRecord(RECORD_A);
    expect(meta.contentHash).to.equal(CONTENT_HASH_A);
    expect(meta.cid).to.equal("cid://record-A");
    expect(meta.patient).to.equal(patient.address);
    expect(meta.anchoredInBatch).to.equal(false);
  });

  it("rejects anchoring the same record id twice", async function () {
    const { recordAnchor, provider, patient } = await loadFixture(deployFixture);
    await (
      await recordAnchor.connect(provider).anchorRecord(RECORD_A, patient.address, CONTENT_HASH_A, "cid://record-A")
    ).wait();

    await expect(
      recordAnchor.connect(provider).anchorRecord(RECORD_A, patient.address, CONTENT_HASH_A, "cid://record-A-dup")
    ).to.be.revertedWith("RecordAnchor: record id already anchored");
  });

  it("rejects anchoring by a caller who is not a registered provider", async function () {
    const { recordAnchor, outsider, patient } = await loadFixture(deployFixture);
    await expect(
      recordAnchor.connect(outsider).anchorRecord(RECORD_A, patient.address, CONTENT_HASH_A, "cid://record-A")
    ).to.be.revertedWith("RecordAnchor: caller is not a registered provider");
  });

  it("anchors a Merkle-batched set of records with one on-chain root write, then registers + verifies each record's inclusion", async function () {
    const { recordAnchor, provider, patient } = await loadFixture(deployFixture);

    const records = Array.from({ length: 5 }, (_, i) => ({
      recordId: ethers.keccak256(ethers.toUtf8Bytes(`batch-record-${i}`)),
      patient: patient.address,
      contentHash: ethers.keccak256(ethers.toUtf8Bytes(`ciphertext-${i}`)),
      cid: `cid://batch-record-${i}`,
    }));

    const { tree, leaves } = buildTree(records);
    const root = getRoot(tree);

    const tx = await recordAnchor.connect(provider).anchorBatch(root, records.length, "cid://batch-manifest-1");
    const receipt = await tx.wait();
    const batchId = 0; // first batch in a fresh fixture

    const batch = await recordAnchor.getBatch(batchId);
    expect(batch.merkleRoot).to.equal(root);
    expect(batch.recordCount).to.equal(BigInt(records.length));

    for (let i = 0; i < records.length; i++) {
      const proof = getProof(tree, leaves[i]);
      await (
        await recordAnchor
          .connect(provider)
          .registerBatchRecord(batchId, records[i].recordId, records[i].patient, records[i].contentHash, records[i].cid, proof)
      ).wait();

      const meta = await recordAnchor.getRecord(records[i].recordId);
      expect(meta.anchoredInBatch).to.equal(true);
      expect(meta.cid).to.equal(records[i].cid);

      const valid = await recordAnchor.verifyInclusion(leafFor(records[i]), proof, root);
      expect(valid).to.equal(true);
    }

    expect(receipt.status).to.equal(1);
  });

  it("rejects a registerBatchRecord call with a proof that does not match the batch's root", async function () {
    const { recordAnchor, provider, patient } = await loadFixture(deployFixture);
    const records = Array.from({ length: 4 }, (_, i) => ({
      recordId: ethers.keccak256(ethers.toUtf8Bytes(`bad-batch-${i}`)),
      patient: patient.address,
      contentHash: ethers.keccak256(ethers.toUtf8Bytes(`ciphertext-bad-${i}`)),
      cid: `cid://bad-batch-${i}`,
    }));
    const { tree, leaves } = buildTree(records);
    const root = getRoot(tree);
    await (await recordAnchor.connect(provider).anchorBatch(root, records.length, "cid://bad-manifest")).wait();

    // Use record 0's data but record 1's proof -> mismatch.
    const wrongProof = getProof(tree, leaves[1]);
    await expect(
      recordAnchor
        .connect(provider)
        .registerBatchRecord(0, records[0].recordId, records[0].patient, records[0].contentHash, records[0].cid, wrongProof)
    ).to.be.revertedWith("RecordAnchor: proof does not match batch Merkle root");
  });
});
