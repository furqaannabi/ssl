// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    CCIPReceiver
} from "@chainlink/contracts-ccip/contracts/applications/CCIPReceiver.sol";
import {Client} from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SSLVault} from "../core/SSLVault.sol";

/**
 * @title SSLCCIPReceiver
 * @notice Receives cross-chain settlement instructions via Chainlink CCIP
 * @dev Decodes the settlement payload and executes it on the local SSLVault.
 *      Only accepts messages from whitelisted source chains and senders.
 */
contract SSLCCIPReceiver is CCIPReceiver, Ownable {
    // ──────────────────────────────────────────────
    //  State
    // ──────────────────────────────────────────────

    SSLVault public vault;

    /// @notice sourceChainSelector => allowed sender address
    mapping(uint64 => address) public allowedSenders;

    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────

    event SettlementReceived(
        bytes32 indexed messageId,
        uint64 indexed sourceChainSelector,
        address buyer,
        address seller,
        uint256 baseAmount,
        uint256 quoteAmount
    );

    event SettlementFailed(bytes32 indexed messageId, bytes reason);

    // ──────────────────────────────────────────────
    //  Errors
    // ──────────────────────────────────────────────

    error UnauthorizedSender(uint64 sourceChainSelector, address sender);

    // ──────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────

    constructor(
        address _router,
        address _vault
    ) CCIPReceiver(_router) Ownable(msg.sender) {
        vault = SSLVault(_vault);
    }

    // ──────────────────────────────────────────────
    //  Admin
    // ──────────────────────────────────────────────

    function setAllowedSender(
        uint64 sourceChainSelector,
        address sender
    ) external onlyOwner {
        allowedSenders[sourceChainSelector] = sender;
    }

    function setVault(address _vault) external onlyOwner {
        vault = SSLVault(_vault);
    }

    // ──────────────────────────────────────────────
    //  CCIP Receive Handler
    // ──────────────────────────────────────────────

    /// @notice Handle incoming CCIP message containing settlement instruction
    function _ccipReceive(
        Client.Any2EVMMessage memory message
    ) internal override {
        // Verify sender
        address sender = abi.decode(message.sender, (address));
        address allowed = allowedSenders[message.sourceChainSelector];

        if (sender != allowed) {
            revert UnauthorizedSender(message.sourceChainSelector, sender);
        }

        // Decode settlement data
        (
            address buyer,
            address seller,
            address baseToken,
            address quoteToken,
            uint256 baseAmount,
            uint256 quoteAmount
        ) = abi.decode(
                message.data,
                (address, address, address, address, uint256, uint256)
            );

        // Execute settlement on vault
        try
            vault.executeCrossChainSettlement(
                buyer,
                seller,
                baseToken,
                quoteToken,
                baseAmount,
                quoteAmount
            )
        {
            emit SettlementReceived(
                message.messageId,
                message.sourceChainSelector,
                buyer,
                seller,
                baseAmount,
                quoteAmount
            );
        } catch (bytes memory reason) {
            emit SettlementFailed(message.messageId, reason);
        }
    }
}
