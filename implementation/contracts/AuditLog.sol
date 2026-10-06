// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./CareChainRegistry.sol";

/// @title AuditLog
/// @notice Append-only audit trail shared by ConsentManager, RecordAnchor and
///         EmergencyAccess. Entries can never be edited or deleted -- only
///         appended -- which is what "immutable audit log" means in this
///         design: the guarantee comes from the contract never exposing an
///         update/delete path, backed by the underlying ledger's own
///         immutability.
contract AuditLog is AccessControl {
    CareChainRegistry public immutable registry;

    enum Action {
        RECORD_ANCHORED,
        BATCH_ANCHORED,
        CONSENT_GRANTED,
        CONSENT_REVOKED,
        ACCESS_GRANTED,
        ACCESS_DENIED,
        EMERGENCY_ACCESS
    }

    struct AuditEntry {
        address actor;
        address patient;
        bytes32 recordId;
        Action action;
        string purpose;
        uint256 timestamp;
        bool isEmergency;
    }

    // Contracts (ConsentManager, RecordAnchor, EmergencyAccess) allowed to append.
    bytes32 public constant LOGGER_ROLE = keccak256("LOGGER_ROLE");

    AuditEntry[] private _entries;
    mapping(address => uint256[]) private _entriesByPatient;

    event AuditEntryAppended(
        uint256 indexed entryId,
        address indexed actor,
        address indexed patient,
        Action action,
        bool isEmergency,
        uint256 timestamp
    );

    constructor(address admin, CareChainRegistry registryAddr) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        registry = registryAddr;
    }

    /// @dev Admin wires up each contract that is allowed to write audit
    /// entries (ConsentManager, RecordAnchor, EmergencyAccess) after deploy.
    function authorizeLogger(address logger) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(LOGGER_ROLE, logger);
    }

    function append(
        address actor,
        address patient,
        bytes32 recordId,
        Action action,
        string calldata purpose,
        bool isEmergency
    ) external onlyRole(LOGGER_ROLE) returns (uint256 entryId) {
        entryId = _entries.length;
        _entries.push(
            AuditEntry({
                actor: actor,
                patient: patient,
                recordId: recordId,
                action: action,
                purpose: purpose,
                timestamp: block.timestamp,
                isEmergency: isEmergency
            })
        );
        _entriesByPatient[patient].push(entryId);
        emit AuditEntryAppended(entryId, actor, patient, action, isEmergency, block.timestamp);
    }

    function totalEntries() external view returns (uint256) {
        return _entries.length;
    }

    function getEntry(uint256 entryId) external view returns (AuditEntry memory) {
        return _entries[entryId];
    }

    /// @notice Returns every audit entry id for a given patient. Callable by
    /// the patient themselves, a registered auditor, or a hospital admin --
    /// never by an arbitrary provider, so browsing the audit trail is itself
    /// access-controlled.
    function getPatientTrail(address patient) external view returns (uint256[] memory) {
        require(
            msg.sender == patient ||
                registry.isAuditor(msg.sender) ||
                registry.hasRole(registry.HOSPITAL_ADMIN_ROLE(), msg.sender),
            "AuditLog: not authorized to view this trail"
        );
        return _entriesByPatient[patient];
    }
}
