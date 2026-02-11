// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IACEComplianceAdapter.sol";

/**
 * @title ACEComplianceAdapter
 * @notice Chainlink ACE (Automated Compliance Engine) adapter for SSL
 * @dev Manages institutional registration and compliance verification.
 *      In production this would integrate with Chainlink's ACE oracle;
 *      for the hackathon it uses an on-chain registry managed by an admin.
 */
contract ACEComplianceAdapter is IACEComplianceAdapter, Ownable {
    // ──────────────────────────────────────────────
    //  State
    // ──────────────────────────────────────────────

    /// @notice wallet => InstitutionInfo
    mapping(address => InstitutionInfo) private _institutions;

    /// @notice Approved compliance officers who can update statuses
    mapping(address => bool) public complianceOfficers;

    // ──────────────────────────────────────────────
    //  Modifiers
    // ──────────────────────────────────────────────

    modifier onlyComplianceOfficer() {
        require(
            complianceOfficers[msg.sender] || msg.sender == owner(),
            "ACE: not compliance officer"
        );
        _;
    }

    // ──────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────

    constructor() Ownable(msg.sender) {
        complianceOfficers[msg.sender] = true;
    }

    // ──────────────────────────────────────────────
    //  Admin
    // ──────────────────────────────────────────────

    function addComplianceOfficer(address officer) external onlyOwner {
        complianceOfficers[officer] = true;
    }

    function removeComplianceOfficer(address officer) external onlyOwner {
        complianceOfficers[officer] = false;
    }

    // ──────────────────────────────────────────────
    //  Registration
    // ──────────────────────────────────────────────

    /// @inheritdoc IACEComplianceAdapter
    function registerInstitution(
        address wallet,
        string calldata jurisdiction,
        uint256 maxTradeSize
    ) external override onlyComplianceOfficer {
        require(wallet != address(0), "ACE: zero address");
        require(
            _institutions[wallet].status == ComplianceStatus.UNKNOWN,
            "ACE: already registered"
        );

        _institutions[wallet] = InstitutionInfo({
            wallet: wallet,
            jurisdiction: jurisdiction,
            status: ComplianceStatus.COMPLIANT,
            maxTradeSize: maxTradeSize,
            registeredAt: block.timestamp,
            lastChecked: block.timestamp
        });

        emit InstitutionRegistered(wallet, jurisdiction);
        emit ComplianceStatusUpdated(wallet, ComplianceStatus.COMPLIANT);
    }

    // ──────────────────────────────────────────────
    //  Status Management
    // ──────────────────────────────────────────────

    /// @inheritdoc IACEComplianceAdapter
    function updateComplianceStatus(
        address wallet,
        ComplianceStatus status
    ) external override onlyComplianceOfficer {
        require(
            _institutions[wallet].status != ComplianceStatus.UNKNOWN,
            "ACE: not registered"
        );
        _institutions[wallet].status = status;
        _institutions[wallet].lastChecked = block.timestamp;
        emit ComplianceStatusUpdated(wallet, status);
    }

    /// @notice Update the max trade size for an institution
    function updateMaxTradeSize(
        address wallet,
        uint256 newMaxTradeSize
    ) external onlyComplianceOfficer {
        require(
            _institutions[wallet].status != ComplianceStatus.UNKNOWN,
            "ACE: not registered"
        );
        _institutions[wallet].maxTradeSize = newMaxTradeSize;
    }

    // ──────────────────────────────────────────────
    //  Compliance Checks
    // ──────────────────────────────────────────────

    /// @inheritdoc IACEComplianceAdapter
    function isCompliant(address wallet) external view override returns (bool) {
        return _institutions[wallet].status == ComplianceStatus.COMPLIANT;
    }

    /// @inheritdoc IACEComplianceAdapter
    function checkTradeCompliance(
        address traderA,
        address traderB,
        uint256 amount
    ) external override returns (bool) {
        InstitutionInfo storage infoA = _institutions[traderA];
        InstitutionInfo storage infoB = _institutions[traderB];

        bool compliant = (infoA.status == ComplianceStatus.COMPLIANT &&
            infoB.status == ComplianceStatus.COMPLIANT &&
            amount <= infoA.maxTradeSize &&
            amount <= infoB.maxTradeSize);

        // Update last checked timestamps
        infoA.lastChecked = block.timestamp;
        infoB.lastChecked = block.timestamp;

        emit TradeComplianceChecked(traderA, traderB, amount, compliant);
        return compliant;
    }

    // ──────────────────────────────────────────────
    //  View
    // ──────────────────────────────────────────────

    /// @inheritdoc IACEComplianceAdapter
    function getInstitutionInfo(
        address wallet
    ) external view override returns (InstitutionInfo memory) {
        return _institutions[wallet];
    }
}
