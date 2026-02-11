// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IACEComplianceAdapter
 * @notice Interface for Chainlink ACE (Automated Compliance Engine) integration
 * @dev Models the core ACE concepts:
 *      - CCID (Cross-Chain Identity): reusable identity with credentials
 *      - Policy Manager: rules engine for compliance enforcement
 *      - Credential-based eligibility checks
 */
interface IACEComplianceAdapter {
    // ──────────────────────────────────────────────
    //  Enums
    // ──────────────────────────────────────────────

    /// @notice Credential types aligned with ACE CCID framework
    enum CredentialType {
        KYC, // Know Your Customer
        AML, // Anti-Money Laundering
        ACCREDITATION, // Investor accreditation status
        JURISDICTION, // Jurisdiction eligibility
        SANCTIONS_CLEAR // Cleared from sanctions/deny lists
    }

    /// @notice Policy types aligned with ACE Policy Manager
    enum PolicyType {
        ALLOWLIST, // Allow/Deny list
        VOLUME_RATE_LIMIT, // Transaction volume limits
        BALANCE_LIMIT, // Max balance per holder
        RBAC // Role-based access control
    }

    // ──────────────────────────────────────────────
    //  Structs
    // ──────────────────────────────────────────────

    /// @notice On-chain representation of a CCID credential
    struct Credential {
        CredentialType credType;
        address issuer; // Who attested this credential (IDV provider, issuer)
        uint256 issuedAt;
        uint256 expiresAt;
        bool valid;
    }

    /// @notice Cross-Chain Identity (CCID) record
    struct CCID {
        address wallet;
        bytes32 identityHash; // Hash of off-chain identity (no PII on-chain)
        string jurisdiction;
        uint256 registeredAt;
        bool active;
    }

    /// @notice Policy configuration for an asset or protocol
    struct Policy {
        PolicyType policyType;
        bool enabled;
        uint256 value; // e.g. max volume, max balance
        uint256 timeWindow; // e.g. rate limit window in seconds
    }

    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────

    event IdentityRegistered(
        address indexed wallet,
        bytes32 identityHash,
        string jurisdiction
    );
    event CredentialIssued(
        address indexed wallet,
        CredentialType credType,
        address indexed issuer
    );
    event CredentialRevoked(address indexed wallet, CredentialType credType);
    event PolicyUpdated(PolicyType policyType, bool enabled, uint256 value);
    event ComplianceCheckPassed(
        address indexed traderA,
        address indexed traderB,
        uint256 amount
    );
    event ComplianceCheckFailed(
        address indexed traderA,
        address indexed traderB,
        string reason
    );

    // ──────────────────────────────────────────────
    //  Identity Management (CCID)
    // ──────────────────────────────────────────────

    /// @notice Register an identity (CCID) for a wallet
    function registerIdentity(
        address wallet,
        bytes32 identityHash,
        string calldata jurisdiction
    ) external;

    /// @notice Issue a credential to a wallet
    function issueCredential(
        address wallet,
        CredentialType credType,
        uint256 validityPeriod
    ) external;

    /// @notice Revoke a credential
    function revokeCredential(address wallet, CredentialType credType) external;

    // ──────────────────────────────────────────────
    //  Policy Management
    // ──────────────────────────────────────────────

    /// @notice Set a compliance policy
    function setPolicy(
        PolicyType policyType,
        bool enabled,
        uint256 value,
        uint256 timeWindow
    ) external;

    // ──────────────────────────────────────────────
    //  Compliance Checks
    // ──────────────────────────────────────────────

    /// @notice Check if a wallet has all required credentials and is eligible
    function isCompliant(address wallet) external view returns (bool);

    /// @notice Full pre-transaction compliance check between two parties
    function checkTradeCompliance(
        address traderA,
        address traderB,
        uint256 amount
    ) external returns (bool);

    // ──────────────────────────────────────────────
    //  View
    // ──────────────────────────────────────────────

    /// @notice Get CCID record for a wallet
    function getIdentity(address wallet) external view returns (CCID memory);

    /// @notice Get a specific credential for a wallet
    function getCredential(
        address wallet,
        CredentialType credType
    ) external view returns (Credential memory);

    /// @notice Check if a wallet has a specific valid credential
    function hasValidCredential(
        address wallet,
        CredentialType credType
    ) external view returns (bool);
}
