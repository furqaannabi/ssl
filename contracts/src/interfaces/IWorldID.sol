// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IWorldID - World ID on-chain verifier interface
/// @notice Verifies World ID zero-knowledge proofs on-chain
interface IWorldID {
    /// @notice Verifies a World ID proof
    /// @param root The Merkle root of the identity group
    /// @param groupId The group ID (1 for Orb-verified)
    /// @param signalHash Hash of the signal (e.g. user address)
    /// @param nullifierHash Unique nullifier to prevent double-signaling
    /// @param externalNullifierHash Hash of the app ID + action
    /// @param proof The zero-knowledge proof (packed as uint256[8])
    function verifyProof(
        uint256 root,
        uint256 groupId,
        uint256 signalHash,
        uint256 nullifierHash,
        uint256 externalNullifierHash,
        uint256[8] calldata proof
    ) external view;
}
