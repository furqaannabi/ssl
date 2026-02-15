// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IReceiver.sol";

/// @title ReceiverTemplate - Abstract receiver for Chainlink CRE reports
/// @notice Validates that reports come from the trusted KeystoneForwarder.
/// @dev Inherit this and implement _processReport() with your business logic.
abstract contract ReceiverTemplate is IReceiver, Ownable {
    address private s_forwarderAddress;

    error InvalidForwarderAddress();
    error InvalidSender(address sender, address expected);

    event ForwarderAddressUpdated(
        address indexed previousForwarder,
        address indexed newForwarder
    );

    constructor(address _forwarderAddress) Ownable(msg.sender) {
        if (_forwarderAddress == address(0)) {
            revert InvalidForwarderAddress();
        }
        s_forwarderAddress = _forwarderAddress;
        emit ForwarderAddressUpdated(address(0), _forwarderAddress);
    }

    function getForwarderAddress() external view returns (address) {
        return s_forwarderAddress;
    }

    /// @inheritdoc IReceiver
    function onReport(
        bytes calldata /* metadata */,
        bytes calldata report
    ) external override {
        if (
            s_forwarderAddress != address(0) && msg.sender != s_forwarderAddress
        ) {
            revert InvalidSender(msg.sender, s_forwarderAddress);
        }
        _processReport(report);
    }

    function setForwarderAddress(address _forwarder) external onlyOwner {
        address prev = s_forwarderAddress;
        s_forwarderAddress = _forwarder;
        emit ForwarderAddressUpdated(prev, _forwarder);
    }

    /// @notice Implement this with your business logic
    function _processReport(bytes calldata report) internal virtual;

    /// @inheritdoc IERC165
    function supportsInterface(
        bytes4 interfaceId
    ) public view virtual override returns (bool) {
        return
            interfaceId == type(IReceiver).interfaceId ||
            interfaceId == type(IERC165).interfaceId;
    }
}
