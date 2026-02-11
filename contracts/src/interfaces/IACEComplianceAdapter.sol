// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IACEComplianceAdapter
 * @notice Interface for Chainlink ACE (Automated Compliance Engine) integration
 * @dev Validates institutional wallets for sanctions, jurisdiction, and eligibility
 */
interface IACEComplianceAdapter {
    // ──────────────────────────────────────────────
    //  Enums
    // ──────────────────────────────────────────────

    enum ComplianceStatus {
        UNKNOWN,
        COMPLIANT,
        NON_COMPLIANT,
        SUSPENDED
    }

    // ──────────────────────────────────────────────
    //  Structs
    // ──────────────────────────────────────────────

    struct InstitutionInfo {
        address wallet;
        string jurisdiction;
        ComplianceStatus status;
        uint256 maxTradeSize;
        uint256 registeredAt;
        uint256 lastChecked;
    }

    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────

    event InstitutionRegistered(address indexed wallet, string jurisdiction);
    event ComplianceStatusUpdated(
        address indexed wallet,
        ComplianceStatus status
    );
    event TradeComplianceChecked(
        address indexed traderA,
        address indexed traderB,
        uint256 amount,
        bool compliant
    );

    // ──────────────────────────────────────────────
    //  Functions
    // ──────────────────────────────────────────────

    /// @notice Register an institution for compliance
    function registerInstitution(
        address wallet,
        string calldata jurisdiction,
        uint256 maxTradeSize
    ) external;

    /// @notice Update compliance status of an institution
    function updateComplianceStatus(
        address wallet,
        ComplianceStatus status
    ) external;

    /// @notice Check if a single wallet is compliant
    function isCompliant(address wallet) external view returns (bool);

    /// @notice Check if a trade between two parties is compliant
    function checkTradeCompliance(
        address traderA,
        address traderB,
        uint256 amount
    ) external returns (bool);

    /// @notice Get institution info
    function getInstitutionInfo(
        address wallet
    ) external view returns (InstitutionInfo memory);
}
