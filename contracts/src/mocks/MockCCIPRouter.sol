// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    IRouterClient
} from "@chainlink/contracts-ccip/contracts/interfaces/IRouterClient.sol";
import {Client} from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";
import {
    CCIPReceiver
} from "@chainlink/contracts-ccip/contracts/applications/CCIPReceiver.sol";

/**
 * @title MockCCIPRouter
 * @notice Mock CCIP router for local testing
 * @dev Simulates Chainlink CCIP router behavior; delivers messages
 *      to the receiver on the same chain for integration testing.
 */
contract MockCCIPRouter is IRouterClient {
    uint256 public constant MOCK_FEE = 0.01 ether;
    uint256 private _messageCount;

    mapping(uint64 => bool) private _supportedChains;

    event MessageSent(
        bytes32 indexed messageId,
        uint64 indexed destinationChainSelector,
        address receiver,
        bytes data,
        uint256 fee
    );

    constructor() {
        // Support common test chain selectors
        _supportedChains[16015286601757825753] = true; // Ethereum Sepolia
        _supportedChains[10344971235874465080] = true; // Base Sepolia
    }

    function addSupportedChain(uint64 chainSelector) external {
        _supportedChains[chainSelector] = true;
    }

    function isChainSupported(
        uint64 chainSelector
    ) external view override returns (bool) {
        return _supportedChains[chainSelector];
    }

    function getFee(
        uint64 /* destinationChainSelector */,
        Client.EVM2AnyMessage memory /* message */
    ) external pure override returns (uint256) {
        return MOCK_FEE;
    }

    function ccipSend(
        uint64 destinationChainSelector,
        Client.EVM2AnyMessage calldata message
    ) external payable override returns (bytes32) {
        require(
            _supportedChains[destinationChainSelector],
            "MockRouter: unsupported chain"
        );
        require(msg.value >= MOCK_FEE, "MockRouter: insufficient fee");

        _messageCount++;
        bytes32 messageId = keccak256(
            abi.encodePacked(block.timestamp, msg.sender, _messageCount)
        );

        address receiver = abi.decode(message.receiver, (address));

        emit MessageSent(
            messageId,
            destinationChainSelector,
            receiver,
            message.data,
            msg.value
        );

        // Simulate delivery: call the receiver directly (same chain for testing)
        Client.EVMTokenAmount[]
            memory emptyTokenAmounts = new Client.EVMTokenAmount[](0);

        Client.Any2EVMMessage memory deliveredMessage = Client.Any2EVMMessage({
            messageId: messageId,
            sourceChainSelector: destinationChainSelector,
            sender: abi.encode(msg.sender),
            data: message.data,
            destTokenAmounts: emptyTokenAmounts
        });

        CCIPReceiver(receiver).ccipReceive(deliveredMessage);

        return messageId;
    }

    receive() external payable {}
}
