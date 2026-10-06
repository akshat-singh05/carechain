// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./CareChainRegistry.sol";
import "./AuditLog.sol";

/// @title ConsentManager
/// @notice Implements contribution (b) from PLAN.md: dynamic, time-bound,
///         purpose-bound patient consent, enforced as an attribute-based
///         access control (ABAC) check rather than a static boolean grant.
///         A consent is only valid if: it has not been revoked, the current
///         block timestamp lies within [validFrom, validUntil], the record
///         scope matches (or the consent is scoped to "all records"), and
///         the requested purpose matches (or the consent covers "any"
///         purpose).
contract ConsentManager {
    CareChainRegistry public immutable registry;
    AuditLog public immutable auditLog;

    // A recordScope of bytes32(0) means "all of this patient's records".
    bytes32 public constant ALL_RECORDS = bytes32(0);
    // A purpose hash of bytes32(0) means "any purpose".
    bytes32 public constant ANY_PURPOSE = bytes32(0);

    struct Consent {
        address patient;
        address provider;
        bytes32 recordScope;
        bytes32 purposeHash; // keccak256(purposeString), 0 = ANY_PURPOSE
        uint256 validFrom;
        uint256 validUntil;
        bool revoked;
    }

    Consent[] private _consents;
    mapping(address => uint256[]) private _consentsByPatient;

    event ConsentGranted(
        uint256 indexed consentId,
        address indexed patient,
        address indexed provider,
        bytes32 recordScope,
        uint256 validFrom,
        uint256 validUntil
    );
    event ConsentRevoked(uint256 indexed consentId, address indexed patient, uint256 timestamp);
    event AccessChecked(
        uint256 indexed consentId,
        address indexed provider,
        bytes32 recordId,
        bool granted,
        uint256 timestamp
    );

    modifier onlyPatient() {
        require(registry.isPatient(msg.sender), "ConsentManager: caller is not a registered patient");
        _;
    }

    constructor(CareChainRegistry registryAddr, AuditLog auditLogAddr) {
        registry = registryAddr;
        auditLog = auditLogAddr;
    }

    /// @param recordScope bytes32(0) for "all records", otherwise a specific record id.
    /// @param purpose Free-text purpose of use (e.g. "treatment", "billing", "research");
    ///        hashed on-chain so the contract never needs to enumerate an allowed-purpose list.
    function grantConsent(
        address provider,
        bytes32 recordScope,
        string calldata purpose,
        uint256 validFrom,
        uint256 validUntil
    ) external onlyPatient returns (uint256 consentId) {
        require(registry.isProvider(provider), "ConsentManager: grantee is not a registered provider");
        require(validUntil > validFrom, "ConsentManager: validUntil must be after validFrom");
        require(validUntil > block.timestamp, "ConsentManager: validUntil is already in the past");

        bytes32 purposeHash = bytes(purpose).length == 0 ? ANY_PURPOSE : keccak256(bytes(purpose));

        consentId = _consents.length;
        _consents.push(
            Consent({
                patient: msg.sender,
                provider: provider,
                recordScope: recordScope,
                purposeHash: purposeHash,
                validFrom: validFrom,
                validUntil: validUntil,
                revoked: false
            })
        );
        _consentsByPatient[msg.sender].push(consentId);

        auditLog.append(msg.sender, msg.sender, recordScope, AuditLog.Action.CONSENT_GRANTED, purpose, false);
        emit ConsentGranted(consentId, msg.sender, provider, recordScope, validFrom, validUntil);
    }

    function revokeConsent(uint256 consentId) external {
        Consent storage c = _consents[consentId];
        require(c.patient == msg.sender, "ConsentManager: only the granting patient may revoke");
        require(!c.revoked, "ConsentManager: consent already revoked");
        c.revoked = true;
        auditLog.append(msg.sender, msg.sender, c.recordScope, AuditLog.Action.CONSENT_REVOKED, "", false);
        emit ConsentRevoked(consentId, msg.sender, block.timestamp);
    }

    /// @notice ABAC check: does `provider` currently have valid consent from
    /// `patient` to access `recordId` for `purpose`? This is a view function
    /// used by RecordAnchor / backend access-request flows; it does not by
    /// itself write an audit entry (callers that act on the result do, via
    /// `checkAndLogAccess`, so the log reflects real access attempts, not
    /// every read-only probe).
    function isConsentValid(
        address patient,
        address provider,
        bytes32 recordId,
        string calldata purpose
    ) public view returns (bool) {
        uint256[] storage ids = _consentsByPatient[patient];
        bytes32 purposeHash = bytes(purpose).length == 0 ? ANY_PURPOSE : keccak256(bytes(purpose));

        for (uint256 i = 0; i < ids.length; i++) {
            Consent storage c = _consents[ids[i]];
            if (c.provider != provider || c.revoked) continue;
            if (block.timestamp < c.validFrom || block.timestamp > c.validUntil) continue;
            if (c.recordScope != ALL_RECORDS && c.recordScope != recordId) continue;
            if (c.purposeHash != ANY_PURPOSE && c.purposeHash != purposeHash) continue;
            return true;
        }
        return false;
    }

    /// @notice Same check as `isConsentValid`, but appends an audit entry
    /// recording whether access was granted or denied. Used by the backend
    /// on an actual (non-emergency) access request, per PLAN.md contribution (b).
    function checkAndLogAccess(
        address patient,
        bytes32 recordId,
        string calldata purpose
    ) external returns (bool granted) {
        granted = isConsentValid(patient, msg.sender, recordId, purpose);
        auditLog.append(
            msg.sender,
            patient,
            recordId,
            granted ? AuditLog.Action.ACCESS_GRANTED : AuditLog.Action.ACCESS_DENIED,
            purpose,
            false
        );
        emit AccessChecked(0, msg.sender, recordId, granted, block.timestamp);
    }

    function getConsent(uint256 consentId) external view returns (Consent memory) {
        return _consents[consentId];
    }

    function getPatientConsentIds(address patient) external view returns (uint256[] memory) {
        return _consentsByPatient[patient];
    }
}
