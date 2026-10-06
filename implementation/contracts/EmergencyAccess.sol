// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./CareChainRegistry.sol";
import "./AuditLog.sol";

/// @title EmergencyAccess
/// @notice Implements contribution (c) from PLAN.md: a "break-glass" path
///         that lets a credentialed emergency responder bypass normal
///         ConsentManager checks, subject to three mandatory properties:
///         (1) every call is written to the shared AuditLog with the
///         `isEmergency` flag set, distinguishing it from ordinary access
///         events; (2) every call flips a `pendingNotification` flag for the
///         patient, which the backend polls and must surface to the patient
///         (this contract cannot itself send a notification, so it makes
///         the obligation impossible to silently drop); (3) each responder
///         is rate-limited to `MAX_EMERGENCY_PER_DAY` invocations per
///         rolling 24h window, so break-glass cannot be used as a routine
///         substitute for normal consent.
contract EmergencyAccess {
    CareChainRegistry public immutable registry;
    AuditLog public immutable auditLog;

    uint256 public constant MAX_EMERGENCY_PER_DAY = 5;
    uint256 public constant WINDOW = 1 days;

    struct EmergencyEvent {
        address responder;
        address patient;
        bytes32 recordId;
        string reason;
        uint256 timestamp;
        bool notified;
    }

    EmergencyEvent[] private _events;
    mapping(address => uint256[]) private _eventsByPatient;
    // responder => timestamps of their emergency calls within the current window
    mapping(address => uint256[]) private _responderCallLog;
    mapping(address => bool) public pendingNotification;

    event EmergencyAccessGranted(
        uint256 indexed eventId,
        address indexed responder,
        address indexed patient,
        bytes32 recordId,
        string reason,
        uint256 timestamp
    );
    event PatientNotified(address indexed patient, uint256 indexed eventId, uint256 timestamp);

    modifier onlyEmergencyResponder() {
        require(
            registry.isEmergencyResponder(msg.sender),
            "EmergencyAccess: caller is not a credentialed emergency responder"
        );
        _;
    }

    constructor(CareChainRegistry registryAddr, AuditLog auditLogAddr) {
        registry = registryAddr;
        auditLog = auditLogAddr;
    }

    function _pruneAndCountRecentCalls(address responder) internal returns (uint256 recentCount) {
        uint256[] storage log = _responderCallLog[responder];
        uint256 cutoff = block.timestamp > WINDOW ? block.timestamp - WINDOW : 0;
        uint256 writeIdx = 0;
        for (uint256 i = 0; i < log.length; i++) {
            if (log[i] >= cutoff) {
                log[writeIdx] = log[i];
                writeIdx++;
            }
        }
        while (log.length > writeIdx) {
            log.pop();
        }
        return log.length;
    }

    /// @notice Break-glass access. Requires no ConsentManager check by
    /// design -- that is the point of an emergency override -- but every
    /// other safeguard (audit, notification flag, rate limit) is mandatory
    /// and cannot be parameterized away by the caller.
    function emergencyAccess(
        address patient,
        bytes32 recordId,
        string calldata reason
    ) external onlyEmergencyResponder returns (uint256 eventId) {
        require(registry.isPatient(patient), "EmergencyAccess: target is not a registered patient");
        require(bytes(reason).length > 0, "EmergencyAccess: a reason is required for the audit record");

        uint256 recentCount = _pruneAndCountRecentCalls(msg.sender);
        require(recentCount < MAX_EMERGENCY_PER_DAY, "EmergencyAccess: responder exceeded daily emergency-access limit");
        _responderCallLog[msg.sender].push(block.timestamp);

        eventId = _events.length;
        _events.push(
            EmergencyEvent({
                responder: msg.sender,
                patient: patient,
                recordId: recordId,
                reason: reason,
                timestamp: block.timestamp,
                notified: false
            })
        );
        _eventsByPatient[patient].push(eventId);
        pendingNotification[patient] = true;

        auditLog.append(msg.sender, patient, recordId, AuditLog.Action.EMERGENCY_ACCESS, reason, true);
        emit EmergencyAccessGranted(eventId, msg.sender, patient, recordId, reason, block.timestamp);
    }

    /// @notice Called by the backend once it has actually delivered a
    /// notification to the patient (email/SMS/in-app). Kept separate from
    /// `emergencyAccess` so that notification delivery -- which can fail for
    /// reasons outside the contract's control -- never blocks the emergency
    /// access itself, while still leaving an on-chain record of when/whether
    /// it happened.
    function markNotified(address patient, uint256 eventId) external {
        require(
            registry.hasRole(registry.HOSPITAL_ADMIN_ROLE(), msg.sender),
            "EmergencyAccess: only a hospital admin (backend service account) may confirm notification"
        );
        EmergencyEvent storage e = _events[eventId];
        require(e.patient == patient, "EmergencyAccess: event/patient mismatch");
        require(!e.notified, "EmergencyAccess: already marked notified");
        e.notified = true;

        bool anyPending = false;
        uint256[] storage ids = _eventsByPatient[patient];
        for (uint256 i = 0; i < ids.length; i++) {
            if (!_events[ids[i]].notified) {
                anyPending = true;
                break;
            }
        }
        pendingNotification[patient] = anyPending;

        emit PatientNotified(patient, eventId, block.timestamp);
    }

    function getEmergencyEvent(uint256 eventId) external view returns (EmergencyEvent memory) {
        return _events[eventId];
    }

    function getPatientEventIds(address patient) external view returns (uint256[] memory) {
        return _eventsByPatient[patient];
    }

    function totalEvents() external view returns (uint256) {
        return _events.length;
    }
}
