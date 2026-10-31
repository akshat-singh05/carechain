// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title OnChainBlob
/// @notice BENCHMARK-ONLY baseline (not part of the CareChain system): stores
///         an entire record payload in contract storage, which is what a
///         "put the record itself on the blockchain" design would do. Used by
///         experiments/scripts/bench-onchain-storage.js to measure the gas
///         that CareChain avoids by anchoring only a hash and a pointer.
contract OnChainBlob {
    mapping(bytes32 => bytes) private _blobs;

    function store(bytes32 id, bytes calldata data) external {
        _blobs[id] = data;
    }

    function size(bytes32 id) external view returns (uint256) {
        return _blobs[id].length;
    }
}
