# SSL Contracts

Solidity smart contracts for the Stealth Settlement Layer. Deployed per chain via Foundry.

## Contracts

### StealthSettlementVault (`src/core/SSLVault.sol`)

Main vault contract deployed on each supported chain. Holds deposited tokens and executes settlement via CRE reports delivered through the KeystoneForwarder.

**Report types:**

| Type | Name | Encoding |
|---|---|---|
| 0 | verify | `(uint8, address user)` |
| 1 | settle | `(uint8, bytes32 orderId, address stealthBuyer, address stealthSeller, address tokenA, address tokenB, uint256 amountA, uint256 amountB)` |
| 2 | withdraw | `(uint8, address user, uint256 withdrawalId)` |
| 3 | crossChainSettle | `(uint8, bytes32 orderId, uint64 destChainSelector, address recipient, address token, uint256 amount)` -- bridges tokens via CCIP |
| 4 | releaseToken | `(uint8, bytes32 orderId, address recipient, address token, uint256 amount)` -- local transfer on destination chain |

**CCIP integration:** The vault holds an immutable `IRouterClient ccipRouter` reference. Report type 3 approves the router, builds a `Client.EVM2AnyMessage` with the token amount, and calls `ccipSend` paying fees in native ETH. Fund the vault with ETH via plain transfer for CCIP fees.

### SSLChains (`src/core/Config.sol`)

Pure helper library -- not deployed. Contains chain constants so magic numbers live in one place:

```solidity
library SSLChains {
    // Base Sepolia
    uint64  constant BASE_SEPOLIA_CCIP_SELECTOR = 10344971235874465080;
    address constant BASE_SEPOLIA_CCIP_ROUTER   = 0xD3b06cEbF099CE7DA4AcCf578aaEBFDBd6e88a93;
    address constant BASE_SEPOLIA_FORWARDER     = 0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5;
    address constant BASE_SEPOLIA_USDC          = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    // Arbitrum Sepolia
    uint64  constant ARB_SEPOLIA_CCIP_SELECTOR  = 3478487238524512106;
    address constant ARB_SEPOLIA_CCIP_ROUTER    = 0x2a9C5afB0d0e4BAb2BCdaE109EC4b0c4Be15a165;
    // ...

    function ccipRouter() internal view returns (address);   // auto-resolve by block.chainid
    function forwarder() internal view returns (address);
    function ccipSelector() internal view returns (uint64);
}
```

The deploy script uses these to auto-resolve addresses, with env-var overrides available.

### ReceiverTemplate (`src/core/ReceiverTemplate.sol`)

Abstract base contract. Validates that `onReport()` calls come from the trusted KeystoneForwarder. Inherit and implement `_processReport()`.

### ISSLVault (`src/interfaces/ISSLVault.sol`)

Vault interface with events: `Funded`, `Verified`, `Settled`, `WithdrawalRequested`, `WithdrawalClaimed`, `CrossChainSettled`, `TokenReleased`.

## Build

```bash
forge install
forge build
forge test -vv
```

## Deploy

The deploy script handles everything -- works for any supported chain:

```bash
./deploy.sh                        # deploy to all chains
CHAIN=baseSepolia ./deploy.sh      # Base Sepolia only
CHAIN=arbitrumSepolia ./deploy.sh  # Arbitrum Sepolia only
```

**What it does:**
1. Loads env vars from `backend/.env`
2. Runs `forge script script/Deploy.s.sol:DeployScript --rpc-url <chain> --broadcast`
3. `Deploy.s.sol` auto-resolves forwarder and CCIP router from `SSLChains` based on the connected chain
4. Extracts deployed vault address from the Foundry broadcast file
5. Writes to `backend/addresses.json` (multi-chain address registry)
6. Updates CRE config (`config.staging.json`) with vault addresses
7. Updates `backend/contracts.json` for backwards compatibility (Base Sepolia only)

**Env vars:**
- `PRIVATE_KEY` -- deployer private key (required)
- `FORWARDER_ADDRESS` -- override KeystoneForwarder (optional, auto-resolved)
- `CCIP_ROUTER` -- override CCIP router (optional, auto-resolved)

**Output:** `backend/addresses.json` with per-chain vault, CCIP router, forwarder, USDC, RPC/WS URLs.

## Adding a New Chain

1. Add constants to `SSLChains` in `src/core/Config.sol` (CCIP selector, router, forwarder)
2. Add an RPC entry in `foundry.toml` under `[rpc_endpoints]`
3. Add the chain to the `CHAINS` array in `deploy.sh`
4. Run `CHAIN=newChain ./deploy.sh`
