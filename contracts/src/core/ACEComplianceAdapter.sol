// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IACEComplianceAdapter} from "../interfaces/IACEComplianceAdapter.sol";

/**
 * @title ACEComplianceAdapter
 * @notice Chainlink ACE (Automated Compliance Engine) adapter for SSL
 * @dev Implements the core ACE concepts for the hackathon:
 *
 *      CCID (Cross-Chain Identity):
 *        - On-chain identity registry with off-chain identity hashes (no PII)
 *        - Reusable credentials (KYC, AML, accreditation, sanctions clearance)
 *        - Credential lifecycle management (issue, expire, revoke)
 *
 *      Policy Manager:
 *        - Configurable compliance policies (allowlist, volume limits, balance limits)
 *        - Pre-transaction eligibility checks
 *        - Out-of-the-box policy enforcement
 *
 *      In production, the Policy Manager runs as a CRE workflow with both
 *      on-chain enforcement and off-chain policy execution. For the hackathon
 *      we keep everything on-chain for demonstrability.
 */
contract ACEComplianceAdapter is IACEComplianceAdapter, Ownable {
    // ──────────────────────────────────────────────
    //  State
    // ──────────────────────────────────────────────

    /// @notice wallet => CCID identity record
    mapping(address => CCID) private _identities;

    /// @notice wallet => credentialType => Credential
    mapping(address => mapping(CredentialType => Credential))
        private _credentials;

    /// @notice policyType => Policy configuration
    mapping(PolicyType => Policy) private _policies;

    /// @notice Allowlist for wallets (PolicyType.ALLOWLIST)
    mapping(address => bool) public allowlist;

    /// @notice Denylist for wallets (sanctions/fraud)
    mapping(address => bool) public denylist;

    /// @notice wallet => rolling volume tracker (for VOLUME_RATE_LIMIT policy)
    mapping(address => uint256) public tradingVolume;
    mapping(address => uint256) public volumeWindowStart;

    /// @notice Authorized credential issuers (IDV providers, compliance officers)
    mapping(address => bool) public authorizedIssuers;

    /// @notice Required credentials for trading eligibility
    CredentialType[] public requiredCredentials;

    // ──────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────

    constructor() Ownable(msg.sender) {
        authorizedIssuers[msg.sender] = true;

        // Default required credentials: KYC + SANCTIONS_CLEAR
        requiredCredentials.push(CredentialType.KYC);
        requiredCredentials.push(CredentialType.SANCTIONS_CLEAR);

        // Default policies
        _policies[PolicyType.ALLOWLIST] = Policy({
            policyType: PolicyType.ALLOWLIST,
            enabled: false,
            value: 0,
            timeWindow: 0
        });

        _policies[PolicyType.VOLUME_RATE_LIMIT] = Policy({
            policyType: PolicyType.VOLUME_RATE_LIMIT,
            enabled: true,
            value: 100_000_000e6, // $100M default limit
            timeWindow: 1 days
        });
    }

    // ──────────────────────────────────────────────
    //  Modifiers
    // ──────────────────────────────────────────────

    modifier onlyAuthorizedIssuer() {
        require(
            authorizedIssuers[msg.sender] || msg.sender == owner(),
            "ACE: not authorized issuer"
        );
        _;
    }

    // ──────────────────────────────────────────────
    //  Admin
    // ──────────────────────────────────────────────

    function addAuthorizedIssuer(address issuer) external onlyOwner {
        authorizedIssuers[issuer] = true;
    }

    function removeAuthorizedIssuer(address issuer) external onlyOwner {
        authorizedIssuers[issuer] = false;
    }

    function setRequiredCredentials(
        CredentialType[] calldata creds
    ) external onlyOwner {
        delete requiredCredentials;
        for (uint256 i = 0; i < creds.length; i++) {
            requiredCredentials.push(creds[i]);
        }
    }

    function addToAllowlist(address wallet) external onlyOwner {
        allowlist[wallet] = true;
    }

    function removeFromAllowlist(address wallet) external onlyOwner {
        allowlist[wallet] = false;
    }

    function addToDenylist(address wallet) external onlyOwner {
        denylist[wallet] = true;
    }

    function removeFromDenylist(address wallet) external onlyOwner {
        denylist[wallet] = false;
    }

    // ──────────────────────────────────────────────
    //  Identity Management (CCID)
    // ──────────────────────────────────────────────

    /// @inheritdoc IACEComplianceAdapter
    function registerIdentity(
        address wallet,
        bytes32 identityHash,
        string calldata jurisdiction
    ) external override onlyAuthorizedIssuer {
        require(wallet != address(0), "ACE: zero address");
        require(
            !_identities[wallet].active,
            "ACE: identity already registered"
        );

        _identities[wallet] = CCID({
            wallet: wallet,
            identityHash: identityHash,
            jurisdiction: jurisdiction,
            registeredAt: block.timestamp,
            active: true
        });

        emit IdentityRegistered(wallet, identityHash, jurisdiction);
    }

    /// @notice Deactivate an identity
    function deactivateIdentity(address wallet) external onlyAuthorizedIssuer {
        require(_identities[wallet].active, "ACE: identity not active");
        _identities[wallet].active = false;
    }

    // ──────────────────────────────────────────────
    //  Credential Management
    // ──────────────────────────────────────────────

    /// @inheritdoc IACEComplianceAdapter
    function issueCredential(
        address wallet,
        CredentialType credType,
        uint256 validityPeriod
    ) external override onlyAuthorizedIssuer {
        require(_identities[wallet].active, "ACE: no active identity");

        _credentials[wallet][credType] = Credential({
            credType: credType,
            issuer: msg.sender,
            issuedAt: block.timestamp,
            expiresAt: block.timestamp + validityPeriod,
            valid: true
        });

        emit CredentialIssued(wallet, credType, msg.sender);
    }

    /// @inheritdoc IACEComplianceAdapter
    function revokeCredential(
        address wallet,
        CredentialType credType
    ) external override onlyAuthorizedIssuer {
        _credentials[wallet][credType].valid = false;
        emit CredentialRevoked(wallet, credType);
    }

    // ──────────────────────────────────────────────
    //  Policy Management
    // ──────────────────────────────────────────────

    /// @inheritdoc IACEComplianceAdapter
    function setPolicy(
        PolicyType policyType,
        bool enabled,
        uint256 value,
        uint256 timeWindow
    ) external override onlyOwner {
        _policies[policyType] = Policy({
            policyType: policyType,
            enabled: enabled,
            value: value,
            timeWindow: timeWindow
        });

        emit PolicyUpdated(policyType, enabled, value);
    }

    // ──────────────────────────────────────────────
    //  Compliance Checks
    // ──────────────────────────────────────────────

    /// @inheritdoc IACEComplianceAdapter
    function isCompliant(address wallet) external view override returns (bool) {
        return _checkWalletCompliance(wallet);
    }

    /// @inheritdoc IACEComplianceAdapter
    function checkTradeCompliance(
        address traderA,
        address traderB,
        uint256 amount
    ) external override returns (bool) {
        // 1. Check denylist (sanctions)
        if (denylist[traderA] || denylist[traderB]) {
            emit ComplianceCheckFailed(
                traderA,
                traderB,
                "DENIED: sanctions/denylist"
            );
            return false;
        }

        // 2. Check allowlist policy (if enabled)
        Policy storage allowlistPolicy = _policies[PolicyType.ALLOWLIST];
        if (allowlistPolicy.enabled) {
            if (!allowlist[traderA] || !allowlist[traderB]) {
                emit ComplianceCheckFailed(
                    traderA,
                    traderB,
                    "DENIED: not on allowlist"
                );
                return false;
            }
        }

        // 3. Check identity and credentials
        if (!_checkWalletCompliance(traderA)) {
            emit ComplianceCheckFailed(
                traderA,
                traderB,
                "DENIED: traderA credentials"
            );
            return false;
        }
        if (!_checkWalletCompliance(traderB)) {
            emit ComplianceCheckFailed(
                traderA,
                traderB,
                "DENIED: traderB credentials"
            );
            return false;
        }

        // 4. Check volume rate limit policy
        Policy storage volumePolicy = _policies[PolicyType.VOLUME_RATE_LIMIT];
        if (volumePolicy.enabled) {
            _updateVolume(traderA, amount, volumePolicy);
            _updateVolume(traderB, amount, volumePolicy);

            if (tradingVolume[traderA] > volumePolicy.value) {
                emit ComplianceCheckFailed(
                    traderA,
                    traderB,
                    "DENIED: traderA volume limit"
                );
                return false;
            }
            if (tradingVolume[traderB] > volumePolicy.value) {
                emit ComplianceCheckFailed(
                    traderA,
                    traderB,
                    "DENIED: traderB volume limit"
                );
                return false;
            }
        }

        emit ComplianceCheckPassed(traderA, traderB, amount);
        return true;
    }

    // ──────────────────────────────────────────────
    //  Internal
    // ──────────────────────────────────────────────

    function _checkWalletCompliance(
        address wallet
    ) internal view returns (bool) {
        // Must have active identity (CCID)
        if (!_identities[wallet].active) return false;

        // Must not be on denylist
        if (denylist[wallet]) return false;

        // Must have all required credentials that are valid and not expired
        for (uint256 i = 0; i < requiredCredentials.length; i++) {
            Credential storage cred = _credentials[wallet][
                requiredCredentials[i]
            ];
            if (!cred.valid || block.timestamp > cred.expiresAt) {
                return false;
            }
        }

        return true;
    }

    function _updateVolume(
        address trader,
        uint256 amount,
        Policy storage policy
    ) internal {
        // Reset window if expired
        if (block.timestamp > volumeWindowStart[trader] + policy.timeWindow) {
            tradingVolume[trader] = 0;
            volumeWindowStart[trader] = block.timestamp;
        }
        tradingVolume[trader] += amount;
    }

    // ──────────────────────────────────────────────
    //  View
    // ──────────────────────────────────────────────

    /// @inheritdoc IACEComplianceAdapter
    function getIdentity(
        address wallet
    ) external view override returns (CCID memory) {
        return _identities[wallet];
    }

    /// @inheritdoc IACEComplianceAdapter
    function getCredential(
        address wallet,
        CredentialType credType
    ) external view override returns (Credential memory) {
        return _credentials[wallet][credType];
    }

    /// @inheritdoc IACEComplianceAdapter
    function hasValidCredential(
        address wallet,
        CredentialType credType
    ) external view override returns (bool) {
        Credential storage cred = _credentials[wallet][credType];
        return cred.valid && block.timestamp <= cred.expiresAt;
    }

    function getPolicy(
        PolicyType policyType
    ) external view returns (Policy memory) {
        return _policies[policyType];
    }

    function getRequiredCredentials()
        external
        view
        returns (CredentialType[] memory)
    {
        return requiredCredentials;
    }
}
