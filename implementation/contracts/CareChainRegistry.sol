// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title CareChainRegistry
/// @notice Identity and role registry for the CareChain permissioned-style
///         network. Every other contract in the system defers to this
///         registry for "is this address allowed to act as a patient /
///         provider / auditor / admin" decisions, which is the application
///         layer's stand-in for a Fabric-style MSP membership check
///         (see PLAN.md, Section 3, for the trade-off this implies).
contract CareChainRegistry is AccessControl {
    bytes32 public constant PATIENT_ROLE = keccak256("PATIENT_ROLE");
    bytes32 public constant PROVIDER_ROLE = keccak256("PROVIDER_ROLE");
    bytes32 public constant HOSPITAL_ADMIN_ROLE = keccak256("HOSPITAL_ADMIN_ROLE");
    bytes32 public constant AUDITOR_ROLE = keccak256("AUDITOR_ROLE");
    // Subset of PROVIDER_ROLE credentialed for break-glass emergency access.
    bytes32 public constant EMERGENCY_RESPONDER_ROLE = keccak256("EMERGENCY_RESPONDER_ROLE");

    struct Patient {
        bool registered;
        string metadataCid; // pointer to encrypted off-chain demographic profile
        uint256 registeredAt;
    }

    struct Provider {
        bool registered;
        string name;
        string specialty;
        string organization;
        uint256 registeredAt;
    }

    mapping(address => Patient) private _patients;
    mapping(address => Provider) private _providers;

    event PatientRegistered(address indexed patient, string metadataCid, uint256 timestamp);
    event ProviderRegistered(address indexed provider, string organization, string specialty, uint256 timestamp);
    event ProviderDeactivated(address indexed provider, uint256 timestamp);

    /// @param admin Address granted DEFAULT_ADMIN_ROLE + HOSPITAL_ADMIN_ROLE at deploy time.
    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(HOSPITAL_ADMIN_ROLE, admin);
        _setRoleAdmin(PATIENT_ROLE, HOSPITAL_ADMIN_ROLE);
        _setRoleAdmin(PROVIDER_ROLE, HOSPITAL_ADMIN_ROLE);
        _setRoleAdmin(AUDITOR_ROLE, HOSPITAL_ADMIN_ROLE);
        _setRoleAdmin(EMERGENCY_RESPONDER_ROLE, HOSPITAL_ADMIN_ROLE);
    }

    function registerPatient(address patientAddr, string calldata metadataCid)
        external
        onlyRole(HOSPITAL_ADMIN_ROLE)
    {
        require(!_patients[patientAddr].registered, "CareChainRegistry: patient already registered");
        _patients[patientAddr] = Patient({registered: true, metadataCid: metadataCid, registeredAt: block.timestamp});
        _grantRole(PATIENT_ROLE, patientAddr);
        emit PatientRegistered(patientAddr, metadataCid, block.timestamp);
    }

    function registerProvider(
        address providerAddr,
        string calldata name,
        string calldata specialty,
        string calldata organization,
        bool emergencyResponder
    ) external onlyRole(HOSPITAL_ADMIN_ROLE) {
        require(!_providers[providerAddr].registered, "CareChainRegistry: provider already registered");
        _providers[providerAddr] = Provider({
            registered: true,
            name: name,
            specialty: specialty,
            organization: organization,
            registeredAt: block.timestamp
        });
        _grantRole(PROVIDER_ROLE, providerAddr);
        if (emergencyResponder) {
            _grantRole(EMERGENCY_RESPONDER_ROLE, providerAddr);
        }
        emit ProviderRegistered(providerAddr, organization, specialty, block.timestamp);
    }

    function deactivateProvider(address providerAddr) external onlyRole(HOSPITAL_ADMIN_ROLE) {
        require(_providers[providerAddr].registered, "CareChainRegistry: provider not registered");
        _revokeRole(PROVIDER_ROLE, providerAddr);
        _revokeRole(EMERGENCY_RESPONDER_ROLE, providerAddr);
        emit ProviderDeactivated(providerAddr, block.timestamp);
    }

    function isPatient(address addr) external view returns (bool) {
        return hasRole(PATIENT_ROLE, addr);
    }

    function isProvider(address addr) external view returns (bool) {
        return hasRole(PROVIDER_ROLE, addr);
    }

    function isEmergencyResponder(address addr) external view returns (bool) {
        return hasRole(EMERGENCY_RESPONDER_ROLE, addr);
    }

    function isAuditor(address addr) external view returns (bool) {
        return hasRole(AUDITOR_ROLE, addr);
    }

    function getPatient(address patientAddr) external view returns (Patient memory) {
        return _patients[patientAddr];
    }

    function getProvider(address providerAddr) external view returns (Provider memory) {
        return _providers[providerAddr];
    }
}
