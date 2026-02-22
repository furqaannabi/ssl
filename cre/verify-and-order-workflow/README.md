# SSL CRE Workflow — `verify-and-order-workflow`

Chainlink CRE workflow for the Stealth Settlement Layer. Handles World ID proof verification, trade settlement (same-chain and cross-chain via CCIP), and withdrawals by writing on-chain reports to the SSL vaults via KeystoneForwarder.

## Actions

The workflow exposes a single HTTP trigger that dispatches on the `action` field:

### `verify`

Validates a World ID proof and marks users as verified on-chain.

1. Calls the World ID cloud API to verify the proof (consensus-aggregated across CRE nodes).
2. For each target chain (all chains, or the `selectedChains` subset):
   - Reads `isVerified(userAddress)` on-chain via `EVMClient.callContract` (no gas, view call).
   - If already verified, skips that chain.
   - If not verified, sends `report(type=0)` to the chain's vault via `EVMClient.writeReport`.
3. Returns per-chain results (`txHash` or `already_verified` or `FAILED`).

**Payload:**
```json
{
  "action": "verify",
  "nullifierHash": "0x...",
  "proof": "0x...",
  "merkle_root": "0x...",
  "credential_type": "orb",
  "verification_level": "orb",
  "signal": "0x...",
  "userAddress": "0x123...",
  "selectedChains": ["baseSepolia", "arbitrumSepolia"]  // optional; omit for all chains
}
```

**Report encoding (type=0):**
```
encodeAbiParameters("uint8 reportType, address user", [0, userAddress])
```

---

### `settle_match`

Settles a matched trade order between a buyer and seller.

**Same-chain** (`quoteChainSelector == baseChainSelector`):
- Sends `report(type=1)` to the vault on `baseChainSelector`.
- Vault transfers `tradeAmount` (base token wei) to `stealthBuyer` and `quoteAmount` (USDC wei) to `stealthSeller`.

**Cross-chain** (`crossChain: true`):
- Sends `report(type=3)` to the source vault (buyer's USDC chain).
- Source vault bridges `quoteAmount` USDC + encoded `(orderId, buyer, seller, rwaToken, rwaAmount)` via CCIP to the destination chain's `SSLCCIPReceiver`.
- Receiver atomically transfers USDC to the seller and calls `vault.ccipSettle(orderId, buyer, rwaToken, rwaAmount)` so the destination vault delivers the RWA token to the buyer and marks the order settled.

**Payload:**
```json
{
  "action": "settle_match",
  "baseTokenAddress": "0x...",      // RWA token address (e.g. tMETA)
  "quoteTokenAddress": "0x...",     // USDC address on the source chain
  "tradeAmount": "5000000000000000000",   // base token in wei (18 decimals) → buyer
  "quoteAmount": "1500000000",            // USDC in wei (6 decimals) → seller
  "baseChainSelector": "ethereum-testnet-sepolia-arbitrum-1",
  "buyer":  { "orderId": "uuid", "stealthAddress": "0x..." },
  "seller": { "orderId": "uuid", "stealthAddress": "0x..." },
  // cross-chain only:
  "crossChain": true,
  "sourceChainSelector": "ethereum-testnet-sepolia-base-1",   // buyer's USDC chain
  "destChainSelector": "ethereum-testnet-sepolia-arbitrum-1", // RWA token chain
  "ccipDestSelector": "3478487238524512106"                   // numeric CCIP selector for dest
}
```

**Report encodings:**
```
// type=1 (same-chain settle)
encodeAbiParameters(
  "uint8, bytes32, address, address, address, address, uint256, uint256",
  [1, orderId, stealthBuyer, stealthSeller, tokenA, tokenB, tradeAmount, quoteAmount]
)

// type=3 (cross-chain settle)
encodeAbiParameters(
  "uint8, bytes32, uint64, address, address, address, address, uint256, address, uint256",
  [3, orderId, ccipDestSelector, destReceiver, buyer, seller, usdcToken, usdcAmount, rwaToken, rwaAmount]
)
// destReceiver = SSLCCIPReceiver on destination chain
// buyer/seller = stealth addresses
// usdcToken / usdcAmount = USDC to bridge to seller
// rwaToken / rwaAmount = RWA to deliver to buyer on destination chain
```

---

### `withdraw`

Processes a user withdrawal.

- Sends `report(type=2)` to the primary chain's vault.
- Vault transfers the requested token amount to the user.

**Payload:**
```json
{
  "action": "withdraw",
  "withdrawalId": "42",
  "userAddress": "0x123...",
  "amount": "1000000000000000000",
  "token": "0x..."
}
```

**Report encoding (type=2):**
```
encodeAbiParameters("uint8, address, uint256", [2, userAddress, withdrawalId])
```

---

## Report Type Reference

| Type | Name | Encoding |
|---|---|---|
| 0 | verify | `(uint8, address user)` |
| 1 | settle | `(uint8, bytes32 orderId, address stealthBuyer, address stealthSeller, address tokenA, address tokenB, uint256 amountA, uint256 amountB)` |
| 2 | withdraw | `(uint8, address user, uint256 withdrawalId)` |
| 3 | crossChainSettle | `(uint8, bytes32 orderId, uint64 destChainSelector, address destReceiver, address buyer, address seller, address usdcToken, uint256 usdcAmount, address rwaToken, uint256 rwaAmount)` |

---

## Configuration (`config.staging.json`)

```json
{
  "authorizedEVMAddress": "0x<backend-signer-address>",
  "gasLimit": "500000",
  "worldIdVerifyUrl": "https://developer.worldcoin.org/api/v2/verify/<app-id>",
  "worldIdAction": "ssl-verify",
  "primaryChain": "baseSepolia",
  "chains": {
    "baseSepolia": {
      "chainId": 84532,
      "chainSelector": "ethereum-testnet-sepolia-base-1",
      "ccipChainSelector": "10344971235874465080",
      "vault": "0x...",
      "ccipReceiver": "0x...",
      "usdc": "0x...",
      "ccipRouter": "0x...",
      "forwarder": "0x..."
    },
    "arbitrumSepolia": { ... }
  }
}
```

The `contracts/deploy.sh` script auto-updates `vault` and `ccipReceiver` addresses after each deployment.

---

## Setup

### 1. Configure environment

```bash
cd cre/verify-and-order-workflow
cp .env.example .env
```

Set `CRE_ETH_PRIVATE_KEY` to a funded private key (required for on-chain writes).

### 2. Install dependencies

```bash
bun install
```

### 3. Simulate locally

Run from the `cre/` project root:

```bash
cre workflow simulate verify-and-order-workflow --target=staging-settings --broadcast --non-interactive \
  --trigger-index 0 \
  --http-payload '{"action":"verify","nullifierHash":"0x...","userAddress":"0x...",...}'
```

The backend calls this automatically in non-production mode by spawning the CRE CLI.

### 4. Deploy to production

```bash
cre workflow deploy verify-and-order-workflow --target=staging-settings
```

Set `CRE_WORKFLOW_ID` in `backend/.env` and `NODE_ENV=production` to switch the backend from CLI simulation to the live CRE gateway.

---

## RPC Configuration (`project.yaml`)

Each chain entry specifies the RPC URL used by the CRE nodes. Use public, non-rate-limited endpoints to avoid 429 errors during simulation:

```yaml
# Arbitrum Sepolia — use the public RPC
rpc-url: https://sepolia-rollup.arbitrum.io/rpc

# Base Sepolia
rpc-url: https://sepolia.base.org
```

Avoid rate-limited demo endpoints (e.g., `alchemy.com/v2/demo`, `api.zan.top`) in CRE configuration.
