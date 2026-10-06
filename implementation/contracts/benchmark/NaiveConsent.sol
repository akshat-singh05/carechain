// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title NaiveConsent
/// @notice NOT part of the CareChain system. This contract exists solely as
///         the baseline for Experiment 5 in PLAN.md (Section 4): the gas/
///         latency cost of a naive boolean access flag versus the ABAC,
///         time-bound, purpose-bound check in ConsentManager.sol. It is
///         intentionally as simple as possible -- a single mapping flip --
///         so the comparison isolates the cost of the ABAC logic itself.
contract NaiveConsent {
    mapping(address => mapping(address => bool)) public granted;

    event Granted(address indexed patient, address indexed provider);
    event Revoked(address indexed patient, address indexed provider);

    function grant(address provider) external {
        granted[msg.sender][provider] = true;
        emit Granted(msg.sender, provider);
    }

    function revoke(address provider) external {
        granted[msg.sender][provider] = false;
        emit Revoked(msg.sender, provider);
    }

    function checkAccess(address patient, address provider) external view returns (bool) {
        return granted[patient][provider];
    }
}
