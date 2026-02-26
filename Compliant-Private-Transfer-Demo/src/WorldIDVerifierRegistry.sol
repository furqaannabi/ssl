// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title WorldIDVerifierRegistry
/// @notice On-chain registry of addresses that have completed World ID verification.
///
/// Write path (canonical):
///   The Chainlink CRE TEE workflow verifies the World ID proof and calls
///   `onReport(bytes, bytes)` via the CRE-authorised forwarder contract.
///   The report is ABI-encoded as `(uint8 reportType, address user)`:
///     • reportType = 0  → verify: sets isVerified[user] = true
///
/// Fallback write path (owner only):
///   `setVerified(address, bool)` lets the owner manually mark/unmark addresses.
///   Used for back-filling existing verified users and operational overrides.
///
/// Read path:
///   WorldIDPolicy calls `isVerified(caller)` before every deposit() into the
///   Convergence private vault.  Unverified callers are rejected on-chain.
contract WorldIDVerifierRegistry is Ownable {

    // ── Errors ───────────────────────────────────────────────────────────────
    error InvalidForwarder();
    error InvalidReportType(uint8 reportType);

    // ── Events ───────────────────────────────────────────────────────────────
    event VerificationStatusSet(address indexed account, bool verified);
    event ForwarderUpdated(address indexed previous, address indexed next);

    // ── State ────────────────────────────────────────────────────────────────

    /// @notice CRE-authorised forwarder that is allowed to call onReport().
    address public forwarder;

    /// @notice Returns true if `account` has passed World ID verification.
    mapping(address => bool) public isVerified;

    // ── Constructor ──────────────────────────────────────────────────────────

    /// @param initialOwner  Backend service wallet (same key as EVM_PRIVATE_KEY).
    /// @param _forwarder    CRE forwarder on ETH Sepolia:
    ///                      0x15fC6ae953E024d975e77382eEeC56A9101f9F88
    constructor(address initialOwner, address _forwarder) Ownable(initialOwner) {
        forwarder = _forwarder;
        emit ForwarderUpdated(address(0), _forwarder);
    }

    // ── Admin ────────────────────────────────────────────────────────────────

    /// @notice Update the CRE forwarder address (owner only).
    function setForwarder(address _forwarder) external onlyOwner {
        emit ForwarderUpdated(forwarder, _forwarder);
        forwarder = _forwarder;
    }

    /// @notice Manually mark or un-mark an address as World ID verified (owner only).
    ///         Use for back-fills or emergency overrides.
    function setVerified(address account, bool verified) external onlyOwner {
        isVerified[account] = verified;
        emit VerificationStatusSet(account, verified);
    }

    /// @notice Batch-verify multiple addresses in one transaction (owner only).
    function batchSetVerified(address[] calldata accounts, bool verified) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            isVerified[accounts[i]] = verified;
            emit VerificationStatusSet(accounts[i], verified);
        }
    }

    // ── CRE report receiver ──────────────────────────────────────────────────

    /// @notice Called by the Chainlink CRE forwarder after TEE attestation.
    /// @dev    The CRE encodes the report as:
    ///           abi.encode(uint8 reportType, address user)
    ///         reportType 0 = World ID verification ✓
    /// @param  /*metadata*/ Ignored (CRE pipeline metadata, not used here).
    /// @param  report       ABI-encoded (uint8 reportType, address user).
    function onReport(bytes calldata /*metadata*/, bytes calldata report) external {
        if (msg.sender != forwarder) revert InvalidForwarder();

        (uint8 reportType, address user) = abi.decode(report, (uint8, address));

        if (reportType == 0) {
            // Verify
            isVerified[user] = true;
            emit VerificationStatusSet(user, true);
        } else {
            revert InvalidReportType(reportType);
        }
    }
}
