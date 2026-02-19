// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@chainlink/contracts-ccip/contracts/interfaces/IAny2EVMMessageReceiver.sol";
import "@chainlink/contracts-ccip/contracts/libraries/Client.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";

interface ISSLVaultSettlement {
    function markSettled(bytes32 orderId) external;
}

/// @title SSLCCIPReceiver
/// @notice Standalone CCIP receiver deployed per chain alongside the vault.
///         Receives programmable token transfers (USDC + orderId/recipient),
///         forwards tokens to the recipient, and calls vault.markSettled().
contract SSLCCIPReceiver is IAny2EVMMessageReceiver, IERC165, Ownable {
    using SafeERC20 for IERC20;

    address public immutable router;
    ISSLVaultSettlement public vault;

    event TokenReleased(
        bytes32 indexed orderId,
        address recipient,
        address token,
        uint256 amount,
        bytes32 ccipMessageId
    );

    error InvalidRouter(address sender);

    modifier onlyRouter() {
        if (msg.sender != router) revert InvalidRouter(msg.sender);
        _;
    }

    constructor(address _router, address _vault) Ownable(msg.sender) {
        router = _router;
        vault = ISSLVaultSettlement(_vault);
    }

    function setVault(address _vault) external onlyOwner {
        vault = ISSLVaultSettlement(_vault);
    }

    /// @inheritdoc IAny2EVMMessageReceiver
    function ccipReceive(
        Client.Any2EVMMessage calldata message
    ) external override onlyRouter {
        _ccipReceive(message);
    }

    function _ccipReceive(
        Client.Any2EVMMessage calldata message
    ) internal {
        (bytes32 orderId, address recipient) = abi.decode(
            message.data,
            (bytes32, address)
        );

        address token = message.destTokenAmounts[0].token;
        uint256 amount = message.destTokenAmounts[0].amount;

        IERC20(token).safeTransfer(recipient, amount);

        vault.markSettled(orderId);

        emit TokenReleased(orderId, recipient, token, amount, message.messageId);
    }

    function getRouter() public view returns (address) {
        return router;
    }

    /// @inheritdoc IERC165
    function supportsInterface(
        bytes4 interfaceId
    ) public pure override returns (bool) {
        return interfaceId == type(IAny2EVMMessageReceiver).interfaceId
            || interfaceId == type(IERC165).interfaceId;
    }
}
