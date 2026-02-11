// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockBondToken
 * @notice Mock tokenized bond for SSL hackathon demo
 * @dev Represents a tokenized real-world asset (e.g. US Treasury Bond)
 */
contract MockBondToken is ERC20, Ownable {
    uint8 private immutable _decimals;

    constructor() ERC20("SSL Tokenized Bond", "BOND") Ownable(msg.sender) {
        _decimals = 18;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// @notice Mint tokens (for testing)
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Burn tokens
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
