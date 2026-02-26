// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Policy} from "@chainlink/policy-management/core/Policy.sol";
import {IPolicyEngine} from "@chainlink/policy-management/interfaces/IPolicyEngine.sol";

interface IWorldIDVerifierRegistry {
    function isVerified(address account) external view returns (bool);
}

/// @title WorldIDPolicy
/// @notice Chainlink ACE policy that enforces World ID "proof-of-humanity" before
///         any deposit into the Convergence private vault is allowed.
///
/// Flow
/// ────
///  1. User calls `deposit(token, amount)` on the Convergence vault.
///  2. Vault calls `policyEngine.run(payload)` where payload.sender = depositor.
///  3. PolicyEngine calls `this.run(caller=depositor, ...)`.
///  4. We query WorldIDVerifierRegistry.isVerified(caller).
///     • Not verified → revert PolicyRejected (deposit blocked on-chain).
///     • Verified     → return PolicyResult.Allowed (deposit proceeds).
///
/// Setup
/// ─────
///  • Deploy one WorldIDVerifierRegistry (shared across all tokens).
///  • Deploy one WorldIDPolicy impl + one proxy per token's PolicyEngine
///    (each proxy must be initialised with the specific PolicyEngine that will call it).
///  • Call policyEngine.addPolicy(vault, depositSelector, proxy, new bytes32[](0))
///    for each token.
///  • Backend calls registry.setVerified(userAddress, true) after World ID proof
///    is validated via the CRE workflow.
contract WorldIDPolicy is Policy {
    string public constant override typeAndVersion = "WorldIDPolicy 1.0.0";

    /// @notice The registry that maps address → World ID verification status.
    IWorldIDVerifierRegistry public registry;

    // ── Initialisation ──────────────────────────────────────────────────────

    /// @notice Called automatically during `initialize()` via the Policy base class.
    /// @param parameters ABI-encoded address of the WorldIDVerifierRegistry.
    function configure(bytes calldata parameters) internal override onlyInitializing {
        require(parameters.length >= 32, "WorldIDPolicy: registry address required");
        address _registry = abi.decode(parameters, (address));
        require(_registry != address(0), "WorldIDPolicy: zero registry");
        registry = IWorldIDVerifierRegistry(_registry);
    }

    // ── Admin ────────────────────────────────────────────────────────────────

    /// @notice Replace the registry after deployment (owner only).
    function setRegistry(address _registry) external onlyOwner {
        require(_registry != address(0), "WorldIDPolicy: zero address");
        registry = IWorldIDVerifierRegistry(_registry);
    }

    // ── Policy logic ─────────────────────────────────────────────────────────

    /// @notice Core compliance check — called by PolicyEngine on every governed operation.
    /// @param caller The EOA that initiated the transaction (the depositor).
    /// @dev Parameters are intentionally unused: we only care about the caller's identity.
    function run(
        address caller,
        address,          /* subject   — the vault contract */
        bytes4,           /* selector  — deposit(address,uint256) */
        bytes[] calldata, /* parameters — extracted calldata fields */
        bytes calldata    /* context   — extra data from the vault */
    ) public view override returns (IPolicyEngine.PolicyResult) {
        if (!registry.isVerified(caller)) {
            revert IPolicyEngine.PolicyRejected("World ID verification required to deposit");
        }
        return IPolicyEngine.PolicyResult.Allowed;
    }
}
