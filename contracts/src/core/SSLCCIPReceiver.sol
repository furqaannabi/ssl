// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@chainlink/contracts-ccip/contracts/interfaces/IAny2EVMMessageReceiver.sol";
import "@chainlink/contracts-ccip/contracts/libraries/Client.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";

interface ISSLVaultSettlement {
    /// @notice Transfers the RWA token to the buyer and marks the order settled.
    ///         Called by this receiver after paying the seller their bridged USDC.
    function ccipSettle(
        bytes32 orderId,
        address buyer,
        address rwaToken,
        uint256 rwaAmount
    ) external;
}

/// @title SSLCCIPReceiver
/// @notice Receives a cross-chain CCIP message carrying USDC + settlement data.
///         On arrival it atomically:
///           1. Transfers the bridged USDC to the seller.
///           2. Calls vault.ccipSettle() so the vault sends the RWA token to the buyer.
contract SSLCCIPReceiver is IAny2EVMMessageReceiver, IERC165, Ownable {
    using SafeERC20 for IERC20;

    address public immutable router;
    ISSLVaultSettlement public vault;

    event CrossChainSettled(
        bytes32 indexed orderId,
        address buyer,
        address seller,
        address usdcToken,
        uint256 usdcAmount,
        address rwaToken,
        uint256 rwaAmount,
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
        (
            bytes32 orderId,
            address buyer,
            address seller,
            address rwaToken,
            uint256 rwaAmount
        ) = abi.decode(message.data, (bytes32, address, address, address, uint256));

        address usdcToken = message.destTokenAmounts[0].token;
        uint256 usdcAmount = message.destTokenAmounts[0].amount;

        // 1. Pay seller their bridged USDC
        IERC20(usdcToken).safeTransfer(seller, usdcAmount);

        // 2. Vault transfers RWA to buyer and marks order settled
        vault.ccipSettle(orderId, buyer, rwaToken, rwaAmount);

        emit CrossChainSettled(
            orderId,
            buyer,
            seller,
            usdcToken,
            usdcAmount,
            rwaToken,
            rwaAmount,
            message.messageId
        );
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
