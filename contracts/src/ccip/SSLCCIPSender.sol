// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    IRouterClient
} from "@chainlink/contracts-ccip/contracts/interfaces/IRouterClient.sol";
import {Client} from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SSLCCIPSender
 * @notice Sends cross-chain settlement instructions via Chainlink CCIP
 * @dev Called by the CRE operator after matching + compliance verification.
 *      Encodes settlement data and sends it to the destination chain
 *      where the SSLCCIPReceiver will execute the settlement.
 */
contract SSLCCIPSender is Ownable {
    // ──────────────────────────────────────────────
    //  State
    // ──────────────────────────────────────────────

    IRouterClient public immutable ccipRouter;

    /// @notice Approved destination chain selectors
    mapping(uint64 => bool) public allowedDestinations;

    /// @notice Destination chain => receiver contract address
    mapping(uint64 => address) public destinationReceivers;

    /// @notice Gas limit for CCIP messages
    uint256 public gasLimit = 400_000;

    // ──────────────────────────────────────────────
    //  Events
    // ──────────────────────────────────────────────

    event SettlementSent(
        bytes32 indexed messageId,
        uint64 indexed destinationChainSelector,
        address buyer,
        address seller,
        uint256 baseAmount,
        uint256 quoteAmount
    );

    event DestinationConfigured(uint64 indexed chainSelector, address receiver);

    // ──────────────────────────────────────────────
    //  Errors
    // ──────────────────────────────────────────────

    error DestinationNotAllowed(uint64 chainSelector);
    error ReceiverNotConfigured(uint64 chainSelector);
    error InsufficientFee(uint256 required, uint256 provided);

    // ──────────────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────────────

    constructor(address _router) Ownable(msg.sender) {
        ccipRouter = IRouterClient(_router);
    }

    // ──────────────────────────────────────────────
    //  Admin
    // ──────────────────────────────────────────────

    function configureDestination(
        uint64 chainSelector,
        address receiver
    ) external onlyOwner {
        allowedDestinations[chainSelector] = true;
        destinationReceivers[chainSelector] = receiver;
        emit DestinationConfigured(chainSelector, receiver);
    }

    function setGasLimit(uint256 _gasLimit) external onlyOwner {
        gasLimit = _gasLimit;
    }

    // ──────────────────────────────────────────────
    //  Send Settlement
    // ──────────────────────────────────────────────

    /**
     * @notice Send a settlement instruction to a destination chain via CCIP
     * @param destinationChainSelector The CCIP chain selector for the destination
     * @param buyer The buyer's address
     * @param seller The seller's address
     * @param baseToken The base token (asset) address on the destination chain
     * @param quoteToken The quote token (settlement token) address on the destination chain
     * @param baseAmount Amount of base token to swap
     * @param quoteAmount Amount of quote token to swap
     * @return messageId The CCIP message ID
     */
    function sendSettlement(
        uint64 destinationChainSelector,
        address buyer,
        address seller,
        address baseToken,
        address quoteToken,
        uint256 baseAmount,
        uint256 quoteAmount
    ) external payable onlyOwner returns (bytes32 messageId) {
        if (!allowedDestinations[destinationChainSelector]) {
            revert DestinationNotAllowed(destinationChainSelector);
        }

        address receiver = destinationReceivers[destinationChainSelector];
        if (receiver == address(0)) {
            revert ReceiverNotConfigured(destinationChainSelector);
        }

        // Encode the settlement data
        bytes memory data = abi.encode(
            buyer,
            seller,
            baseToken,
            quoteToken,
            baseAmount,
            quoteAmount
        );

        // Build CCIP message using official Client library
        Client.EVM2AnyMessage memory message = Client.EVM2AnyMessage({
            receiver: abi.encode(receiver),
            data: data,
            tokenAmounts: new Client.EVMTokenAmount[](0),
            feeToken: address(0), // pay in native
            extraArgs: Client._argsToBytes(
                Client.EVMExtraArgsV2({
                    gasLimit: gasLimit,
                    allowOutOfOrderExecution: true
                })
            )
        });

        // Get fee
        uint256 fee = ccipRouter.getFee(destinationChainSelector, message);
        if (msg.value < fee) {
            revert InsufficientFee(fee, msg.value);
        }

        // Send via CCIP
        messageId = ccipRouter.ccipSend{value: fee}(
            destinationChainSelector,
            message
        );

        emit SettlementSent(
            messageId,
            destinationChainSelector,
            buyer,
            seller,
            baseAmount,
            quoteAmount
        );

        // Refund excess
        if (msg.value > fee) {
            (bool success, ) = msg.sender.call{value: msg.value - fee}("");
            require(success, "SSL: refund failed");
        }
    }

    /**
     * @notice Estimate fee for sending a settlement message
     */
    function estimateFee(
        uint64 destinationChainSelector,
        address buyer,
        address seller,
        address baseToken,
        address quoteToken,
        uint256 baseAmount,
        uint256 quoteAmount
    ) external view returns (uint256) {
        address receiver = destinationReceivers[destinationChainSelector];

        bytes memory data = abi.encode(
            buyer,
            seller,
            baseToken,
            quoteToken,
            baseAmount,
            quoteAmount
        );

        Client.EVM2AnyMessage memory message = Client.EVM2AnyMessage({
            receiver: abi.encode(receiver),
            data: data,
            tokenAmounts: new Client.EVMTokenAmount[](0),
            feeToken: address(0),
            extraArgs: Client._argsToBytes(
                Client.EVMExtraArgsV2({
                    gasLimit: gasLimit,
                    allowOutOfOrderExecution: true
                })
            )
        });

        return ccipRouter.getFee(destinationChainSelector, message);
    }

    receive() external payable {}
}
