// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/core/SSLCCIPReceiver.sol";
import "../src/mocks/MockUSDC.sol";
import "@chainlink/contracts-ccip/contracts/interfaces/IAny2EVMMessageReceiver.sol";
import "@chainlink/contracts-ccip/contracts/libraries/Client.sol";
import "@openzeppelin/contracts/utils/introspection/IERC165.sol";

// ── Minimal vault mock ──
contract MockSSLVault {
    mapping(bytes32 => bool) public settledOrders;

    function markSettled(bytes32 orderId) external {
        settledOrders[orderId] = true;
    }
}

contract SSLCCIPReceiverTest is Test {
    SSLCCIPReceiver public receiver;
    MockSSLVault public mockVault;
    MockUSDC public token;

    address public routerAddr = makeAddr("router");
    address public recipient = makeAddr("recipient");

    uint256 public constant TRANSFER_AMOUNT = 1_000e6;

    function setUp() public {
        token = new MockUSDC();
        mockVault = new MockSSLVault();
        receiver = new SSLCCIPReceiver(routerAddr, address(mockVault));
    }

    // ── Helpers ──

    function _buildMessage(
        bytes32 msgId,
        bytes32 orderId,
        address _recipient,
        address _token,
        uint256 amount
    ) internal pure returns (Client.Any2EVMMessage memory) {
        Client.EVMTokenAmount[] memory tokenAmounts = new Client.EVMTokenAmount[](1);
        tokenAmounts[0] = Client.EVMTokenAmount({token: _token, amount: amount});

        return Client.Any2EVMMessage({
            messageId: msgId,
            sourceChainSelector: 16015286601757825753,
            sender: abi.encode(address(0xABCD)),
            data: abi.encode(orderId, _recipient),
            destTokenAmounts: tokenAmounts
        });
    }

    // ── ccipReceive ──

    function test_CcipReceiveTransfersTokens() public {
        bytes32 orderId = keccak256("order_1");
        token.mint(address(receiver), TRANSFER_AMOUNT);

        Client.Any2EVMMessage memory message = _buildMessage(
            keccak256("msg_1"),
            orderId,
            recipient,
            address(token),
            TRANSFER_AMOUNT
        );

        vm.prank(routerAddr);
        receiver.ccipReceive(message);

        assertEq(token.balanceOf(recipient), TRANSFER_AMOUNT);
        assertEq(token.balanceOf(address(receiver)), 0);
    }

    function test_CcipReceiveMarksSettled() public {
        bytes32 orderId = keccak256("order_settled");
        token.mint(address(receiver), TRANSFER_AMOUNT);

        Client.Any2EVMMessage memory message = _buildMessage(
            keccak256("msg_2"),
            orderId,
            recipient,
            address(token),
            TRANSFER_AMOUNT
        );

        vm.prank(routerAddr);
        receiver.ccipReceive(message);

        assertTrue(mockVault.settledOrders(orderId));
    }

    function test_CcipReceiveEmitsTokenReleased() public {
        bytes32 orderId = keccak256("order_event");
        bytes32 msgId = keccak256("msg_event");
        token.mint(address(receiver), TRANSFER_AMOUNT);

        Client.Any2EVMMessage memory message = _buildMessage(
            msgId,
            orderId,
            recipient,
            address(token),
            TRANSFER_AMOUNT
        );

        vm.expectEmit(true, false, false, true);
        emit SSLCCIPReceiver.TokenReleased(orderId, recipient, address(token), TRANSFER_AMOUNT, msgId);

        vm.prank(routerAddr);
        receiver.ccipReceive(message);
    }

    function test_RevertCcipReceiveNotRouter() public {
        bytes32 orderId = keccak256("order_unauth");
        token.mint(address(receiver), TRANSFER_AMOUNT);

        Client.Any2EVMMessage memory message = _buildMessage(
            keccak256("msg_unauth"),
            orderId,
            recipient,
            address(token),
            TRANSFER_AMOUNT
        );

        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(SSLCCIPReceiver.InvalidRouter.selector, attacker)
        );
        receiver.ccipReceive(message);
    }

    function test_CcipReceivePartialAmount() public {
        bytes32 orderId = keccak256("order_partial");
        uint256 partialAmount = TRANSFER_AMOUNT / 4;
        token.mint(address(receiver), partialAmount);

        Client.Any2EVMMessage memory message = _buildMessage(
            keccak256("msg_partial"),
            orderId,
            recipient,
            address(token),
            partialAmount
        );

        vm.prank(routerAddr);
        receiver.ccipReceive(message);

        assertEq(token.balanceOf(recipient), partialAmount);
        assertTrue(mockVault.settledOrders(orderId));
    }

    // ── setVault ──

    function test_SetVault() public {
        MockSSLVault newVault = new MockSSLVault();
        receiver.setVault(address(newVault));
        assertEq(address(receiver.vault()), address(newVault));
    }

    function test_RevertSetVaultNotOwner() public {
        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        vm.expectRevert();
        receiver.setVault(makeAddr("newVault"));
    }

    // ── getRouter ──

    function test_GetRouter() public view {
        assertEq(receiver.getRouter(), routerAddr);
    }

    // ── supportsInterface ──

    function test_SupportsInterfaceAny2EVMMessageReceiver() public view {
        assertTrue(
            receiver.supportsInterface(type(IAny2EVMMessageReceiver).interfaceId)
        );
    }

    function test_SupportsInterfaceERC165() public view {
        assertTrue(receiver.supportsInterface(type(IERC165).interfaceId));
    }

    function test_DoesNotSupportRandomInterface() public view {
        assertFalse(receiver.supportsInterface(bytes4(0xdeadbeef)));
    }

    // ── Integration: multiple messages ──

    function test_MultipleMessagesSettledIndependently() public {
        bytes32 orderId1 = keccak256("multi_order_1");
        bytes32 orderId2 = keccak256("multi_order_2");
        address recipient2 = makeAddr("recipient2");

        token.mint(address(receiver), TRANSFER_AMOUNT * 2);

        // First message
        Client.Any2EVMMessage memory msg1 = _buildMessage(
            keccak256("multi_msg_1"),
            orderId1,
            recipient,
            address(token),
            TRANSFER_AMOUNT
        );
        vm.prank(routerAddr);
        receiver.ccipReceive(msg1);

        // Second message
        Client.Any2EVMMessage memory msg2 = _buildMessage(
            keccak256("multi_msg_2"),
            orderId2,
            recipient2,
            address(token),
            TRANSFER_AMOUNT
        );
        vm.prank(routerAddr);
        receiver.ccipReceive(msg2);

        assertEq(token.balanceOf(recipient), TRANSFER_AMOUNT);
        assertEq(token.balanceOf(recipient2), TRANSFER_AMOUNT);
        assertTrue(mockVault.settledOrders(orderId1));
        assertTrue(mockVault.settledOrders(orderId2));
    }
}
