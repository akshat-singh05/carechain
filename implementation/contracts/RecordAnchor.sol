// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "./CareChainRegistry.sol";
import "./AuditLog.sol";

/// @title RecordAnchor
/// @notice Implements contribution (d) from PLAN.md: records are anchored
///         on-chain either individually (`anchorRecord`, the baseline used
///         in the cost-comparison experiment) or in Merkle-batched form
///         (`anchorBatch`), where only the batch's Merkle root is written
///         on-chain and each record's membership is later provable via
///         `verifyInclusion` against that root. The encrypted record bytes
///         themselves are never on-chain -- only a content hash, an
///         off-chain storage pointer (CID), and non-sensitive metadata.
contract RecordAnchor {
    CareChainRegistry public immutable registry;
    AuditLog public immutable auditLog;

    struct RecordMeta {
        bytes32 contentHash; // sha256 of the *encrypted* record ciphertext
        string cid; // content-addressed pointer into off-chain storage
        address uploader;
        address patient;
        uint256 timestamp;
        bool anchoredInBatch;
    }

    struct Batch {
        bytes32 merkleRoot;
        uint256 recordCount;
        string batchCid; // pointer to the off-chain manifest listing every leaf in this batch
        address anchoredBy;
        uint256 timestamp;
    }

    mapping(bytes32 => RecordMeta) private _records; // recordId => metadata
    mapping(address => bytes32[]) private _recordsByPatient;
    Batch[] private _batches;

    event RecordAnchored(bytes32 indexed recordId, address indexed patient, bytes32 contentHash, string cid);
    event BatchAnchored(uint256 indexed batchId, bytes32 merkleRoot, uint256 recordCount, string batchCid);

    modifier onlyProvider() {
        require(registry.isProvider(msg.sender), "RecordAnchor: caller is not a registered provider");
        _;
    }

    constructor(CareChainRegistry registryAddr, AuditLog auditLogAddr) {
        registry = registryAddr;
        auditLog = auditLogAddr;
    }

    /// @notice Baseline: one on-chain transaction per record.
    function anchorRecord(
        bytes32 recordId,
        address patient,
        bytes32 contentHash,
        string calldata cid
    ) external onlyProvider {
        require(registry.isPatient(patient), "RecordAnchor: target is not a registered patient");
        require(_records[recordId].timestamp == 0, "RecordAnchor: record id already anchored");

        _records[recordId] = RecordMeta({
            contentHash: contentHash,
            cid: cid,
            uploader: msg.sender,
            patient: patient,
            timestamp: block.timestamp,
            anchoredInBatch: false
        });
        _recordsByPatient[patient].push(recordId);

        auditLog.append(msg.sender, patient, recordId, AuditLog.Action.RECORD_ANCHORED, "record-upload", false);
        emit RecordAnchored(recordId, patient, contentHash, cid);
    }

    /// @notice Contribution (d): anchor an entire batch of records with a
    /// single on-chain transaction by writing only the Merkle root. Off-chain,
    /// the batching service builds leaves as keccak256(abi.encodePacked(recordId,
    /// patient, contentHash, cid)) for every record in the batch; that same
    /// leaf construction is required by `verifyInclusion`.
    function anchorBatch(
        bytes32 merkleRoot,
        uint256 recordCount,
        string calldata batchCid
    ) external onlyProvider returns (uint256 batchId) {
        require(recordCount > 0, "RecordAnchor: batch must contain at least one record");

        batchId = _batches.length;
        _batches.push(
            Batch({
                merkleRoot: merkleRoot,
                recordCount: recordCount,
                batchCid: batchCid,
                anchoredBy: msg.sender,
                timestamp: block.timestamp
            })
        );

        auditLog.append(
            msg.sender,
            address(0),
            merkleRoot,
            AuditLog.Action.BATCH_ANCHORED,
            "batch-upload",
            false
        );
        emit BatchAnchored(batchId, merkleRoot, recordCount, batchCid);
    }

    /// @notice Registers the individual record's metadata against an already
    /// anchored batch, so later reads (`getRecord`) work the same way
    /// regardless of whether a record was anchored individually or in a batch.
    /// This does not re-anchor anything on-chain -- the trust anchor is the
    /// batch's Merkle root, already committed by `anchorBatch`.
    function registerBatchRecord(
        uint256 batchId,
        bytes32 recordId,
        address patient,
        bytes32 contentHash,
        string calldata cid,
        bytes32[] calldata proof
    ) external onlyProvider {
        require(batchId < _batches.length, "RecordAnchor: unknown batch");
        require(_records[recordId].timestamp == 0, "RecordAnchor: record id already registered");

        bytes32 leaf = keccak256(abi.encodePacked(recordId, patient, contentHash, cid));
        require(
            MerkleProof.verify(proof, _batches[batchId].merkleRoot, leaf),
            "RecordAnchor: proof does not match batch Merkle root"
        );

        _records[recordId] = RecordMeta({
            contentHash: contentHash,
            cid: cid,
            uploader: msg.sender,
            patient: patient,
            timestamp: block.timestamp,
            anchoredInBatch: true
        });
        _recordsByPatient[patient].push(recordId);
    }

    function verifyInclusion(
        bytes32 leaf,
        bytes32[] calldata proof,
        bytes32 root
    ) external pure returns (bool) {
        return MerkleProof.verify(proof, root, leaf);
    }

    function getRecord(bytes32 recordId) external view returns (RecordMeta memory) {
        return _records[recordId];
    }

    function getBatch(uint256 batchId) external view returns (Batch memory) {
        return _batches[batchId];
    }

    function getPatientRecordIds(address patient) external view returns (bytes32[] memory) {
        return _recordsByPatient[patient];
    }

    function totalBatches() external view returns (uint256) {
        return _batches.length;
    }
}
