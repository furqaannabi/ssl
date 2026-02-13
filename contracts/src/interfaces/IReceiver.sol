// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title IReceiver - Receives Chainlink CRE keystone reports
/// @notice Implementations must support the IReceiver interface through ERC165.
interface IReceiver is IERC165 {
    /// @notice Handles incoming keystone reports.
    /// @param metadata Report metadata (workflowId, workflowName, workflowOwner).
    /// @param report Workflow report (ABI-encoded payload).
    function onReport(bytes calldata metadata, bytes calldata report) external;
}
