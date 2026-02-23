# SSL Contracts

Solidity smart contracts for the Stealth Settlement Layer. Deployed per chain via Foundry.

## Contracts

### StealthSettlementVault (`src/core/SSLVault.sol`)

Main vault contract deployed on each supported chain. Holds deposited tokens and executes settlement via CRE reports delivered through the KeystoneForwarder. Enforces a **token whitelist** -- only owner-approved RWA tokens (stocks, ETFs, bonds) can be deposited via `fund()`.

**Report types:**

| Type | Name | Encoding |
|---|---|---|
| 0 | verify | `(uint8, address user)` |
| 1 | settle | `(uint8, bytes32 orderId, address stealthBuyer, address stealthSeller, address tokenA, address tokenB, uint256 amountA, uint256 amountB)` |
| 2 | withdraw | `(uint8, address user, uint256 withdrawalId)` |
| 3 | crossChainSettle | `(uint8, bytes32 orderId, uint64 destChainSelector, address destReceiver, address buyer, address seller, address usdcToken, uint256 usdcAmount, address rwaToken, uint256 rwaAmount)` -- bridges USDC via CCIP; receiver atomically pays seller and delivers RWA to buyer |

**CCIP integration (two-contract pattern):**

- The **vault** initiates programmable token transfers on `crossChainSettle` (type=3). It approves the CCIP router, encodes `(orderId, buyer, seller, rwaToken, rwaAmount)` as message data alongside the USDC token amount, and calls `ccipSend`, paying fees in LINK (vault must be pre-funded with LINK -- deploy seeds 2 LINK).
- The **SSLCCIPReceiver** on the destination chain is the CCIP message receiver. Its `ccipReceive` hook atomically:
  1. Transfers the bridged USDC to the seller's stealth address
  2. Calls `vault.ccipSettle(orderId, buyer, rwaToken, rwaAmount)` so the vault transfers the RWA token to the buyer's stealth address and marks the order settled

### Why USDC is not transferred via CCIP on testnet

Real USDC on testnet uses Circle's **Cross-Chain Transfer Protocol (CCTP)**. When CCIP tries to bridge a CCTP token, Circle's token pool appends **64 bytes of nonce/version data** to the transfer. The testnet `FeeQuoter` contract rejects this extra data and throws:

```
SourceTokenDataTooLarge(usdcTokenAddress)
```

This is a **testnet-only limitation** — mainnet's FeeQuoter is fully configured for USDC/CCTP.

**Current workaround (testnet):** `_processCrossChainSettle` sends a data-only CCIP message with no token transfer. The USDC transfer is commented out:

```solidity
/* TODO: Uncomment for mainnet — SourceTokenDataTooLarge on testnet because
   Circle's CCTP token pool appends 64 bytes of extra data that the testnet
   FeeQuoter rejects.

   Client.EVMTokenAmount[] memory tokenAmounts = new Client.EVMTokenAmount[](1);
   tokenAmounts[0] = Client.EVMTokenAmount({ token: usdcToken, amount: usdcAmount });
*/
Client.EVMTokenAmount[] memory tokenAmounts = new Client.EVMTokenAmount[](0);
```

The CCIP message still carries `(orderId, buyer, seller, rwaToken, rwaAmount)` so the destination `SSLCCIPReceiver` can deliver the RWA token to the buyer. On testnet the USDC leg of settlement is omitted.

**Mainnet checklist before deploying:**
- [ ] Uncomment `tokenAmounts` block in `SSLVault._processCrossChainSettle`
- [ ] Remove the `tokenAmounts = new Client.EVMTokenAmount[](0)` line
- [ ] Ensure vault holds sufficient USDC before cross-chain settlement
- [ ] Confirm the CCIP lane for the target chain supports USDC at [ccip.chain.link](https://ccip.chain.link)

---

### SSLChains (`src/core/Config.sol`)

Pure helper library -- not deployed. Contains chain constants so magic numbers live in one place:

```solidity
library SSLChains {
    // Base Sepolia
    uint64  constant BASE_SEPOLIA_CCIP_SELECTOR = 10344971235874465080;
    address constant BASE_SEPOLIA_CCIP_ROUTER   = 0xD3b06cEbF099CE7DA4AcCf578aaEBFDBd6e88a93;
    address constant BASE_SEPOLIA_FORWARDER     = 0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5;
    address constant BASE_SEPOLIA_USDC          = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    address constant BASE_SEPOLIA_LINK          = 0xE4aB69C077896252FAFBD49EFD26B5D171A32410;

    // Arbitrum Sepolia, Ethereum Sepolia ...

    function ccipRouter() internal view returns (address);   // auto-resolve by block.chainid
    function forwarder() internal view returns (address);
    function linkToken() internal view returns (address);
    function ccipSelector() internal view returns (uint64);
}
```

The deploy script uses these to auto-resolve addresses, with env-var overrides available.

### ReceiverTemplate (`src/core/ReceiverTemplate.sol`)

Abstract base contract. Validates that `onReport()` calls come from the trusted KeystoneForwarder. Inherit and implement `_processReport()`.

### ISSLVault (`src/interfaces/ISSLVault.sol`)

Vault interface with events: `Funded`, `Verified`, `Settled`, `WithdrawalRequested`, `WithdrawalClaimed`, `CrossChainSettled`, `TokenReleased`, `TokenWhitelisted`, `TokenRemoved`.

### MockRWAToken (`src/mocks/MockRWAToken.sol`)

Generic mock ERC-20 for deploying tokenized Real World Assets. Accepts configurable name, symbol, and decimals. Used to deploy tMETA, tGOOGL, tAAPL, tTSLA, tAMZN, tNVDA, tSPY, tQQQ, tBOND.

### SSLCCIPReceiver (`src/core/SSLCCIPReceiver.sol`)

Standalone CCIP receiver contract deployed per chain. It:

- Implements `IAny2EVMMessageReceiver` with a router-only `ccipReceive`
- Decodes `(orderId, buyer, seller, rwaToken, rwaAmount)` from `message.data`
- Transfers the bridged USDC to the seller's stealth address
- Calls `vault.ccipSettle(orderId, buyer, rwaToken, rwaAmount)` which transfers the RWA token to the buyer and marks the order settled

## Token Whitelist

The vault enforces that only whitelisted tokens can be deposited. Owner-only management functions:

- `whitelistToken(address token, string symbol, string name, uint8 tokenType)` -- Add a token (types: 0=STOCK, 1=ETF, 2=BOND, 3=COMMODITY, 4=STABLE)
- `removeToken(address token)` -- Deactivate a token
- `isTokenWhitelisted(address token)` -- Check whitelist status
- `getWhitelistedTokens()` -- List all whitelisted token addresses

The `fund()` function reverts with `"SSL: token not whitelisted"` for non-approved tokens.

## Build

CCIP contracts are installed via npm (`@chainlink/contracts-ccip` in `node_modules`). The `remappings.txt` and `foundry.toml` are pre-configured to resolve these imports.

```bash
npm install        # or: bun install
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
- `LINK_TOKEN` -- override LINK token (optional, auto-resolved)
- `LINK_FUND` -- LINK to seed vault with (optional, default 2 LINK)

**Output:** `backend/addresses.json` with per-chain vault, CCIP receiver, CCIP router, forwarder, USDC, LINK, RPC/WS URLs.

## Deploy RWA Tokens

After deploying the vault, deploy all tokenized RWA assets and whitelist them (including USDC):

**Using the shell script (recommended):**

```bash
./deploy-rwa.sh                          # deploy to all chains
CHAIN=baseSepolia ./deploy-rwa.sh        # single chain
```

The script reads vault addresses from `backend/addresses.json`, deploys tokens, extracts addresses from broadcast files, writes `backend/rwa-tokens.json`, and auto-whitelists USDC via `cast send`.

**Or manually via forge:**

```bash
VAULT_ADDRESS=0x... forge script script/DeployRWATokens.s.sol:DeployRWATokens --rpc-url baseSepolia --broadcast
```

**Env vars:**
- `PRIVATE_KEY` -- deployer (must be vault owner)
- `VAULT_ADDRESS` -- deployed StealthSettlementVault address
- `MINT_TO` -- address to receive initial supply (optional, defaults to deployer)
- `MINT_AMOUNT` -- tokens per asset in whole units (optional, default 1,000,000)
- `USDC_ADDRESS` -- override USDC address (optional, auto-resolved per chain from `SSLChains`)

**Deploys 9 tokens:** tMETA, tGOOGL, tAAPL, tTSLA, tAMZN, tNVDA, tSPY, tQQQ, tBOND. Each is minted and whitelisted on the vault in a single transaction. USDC is auto-whitelisted using the chain-specific address from `SSLChains` (or `USDC_ADDRESS` env override).

## Adding a New Chain

1. Add constants to `SSLChains` in `script/Config.sol` (CCIP selector, router, forwarder, LINK)
2. Add an RPC entry in `foundry.toml` under `[rpc_endpoints]`
3. Add the chain to the `CHAINS` array in `deploy.sh`
4. Run `CHAIN=newChain ./deploy.sh`
