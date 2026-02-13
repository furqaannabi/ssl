// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IWorldID.sol";

/// @title MockWorldID - Mock World ID verifier for testing
/// @dev Always passes verification. Use in tests only.
contract MockWorldID is IWorldID {
    function verifyProof(
        uint256,
        uint256,
        uint256,
        uint256,
        uint256,
        uint256[8] calldata
    ) external pure override {
        // Always passes — mock for testing
    }
}
