# SSL CRE Workflow — `verify-and-order-workflow`

Chainlink CRE workflow for World ID proof verification, trade settlement, and withdrawals. Writes on-chain reports via the CRE KeystoneForwarder to contracts on **Ethereum Sepolia**.

## Actions

Single HTTP trigger dispatching on the `action` field.

---

### `verify`

Validates a World ID proof and marks the user as verified on-chain.

1. Calls the World ID cloud API to verify the ZK proof (consensus-aggregated across CRE nodes).
2. For each target chain (or `selectedChains` subset):
   - Reads `isVerified(userAddress)` on-chain via `EVMClient.callContract`.
   - If already verified, skips that chain.
   - If not verified, sends `report(type=0)` to the `WorldIDVerifierRegistry` (if `worldIdRegistry` is set in config) or the vault as fallback.
3. `WorldIDVerifierRegistry.onReport()` decodes the report and sets `isVerified[user] = true`.

**Payload:**
```json
{
  "action": "verify",
  "nullifier_hash": "0x...",
  "proof": "0x...",
  "merkle_root": "0x...",
  "verification_level": "orb",
  "userAddress": "0x123...",
  "selectedChains": ["ethSepolia"]
}
```

**Report encoding (type=0):**
```
encodeAbiParameters("uint8 reportType, address user", [0, userAddress])
```

Report target: `chainCfg.worldIdRegistry` (preferred) or `chainCfg.vault` as fallback.

---

### `settle_match`

Settles a matched trade order between a buyer and seller via the SSL vault.

**Payload:**
```json
{
  "action": "settle_match",
  "baseTokenAddress": "0x...",
  "quoteTokenAddress": "0x...",
  "tradeAmount": "5000000000000000000",
  "quoteAmount": "1500000000",
  "baseChainSelector": "ethereum-testnet-sepolia",
  "buyer":  { "orderId": "uuid", "stealthAddress": "0x..." },
  "seller": { "orderId": "uuid", "stealthAddress": "0x..." }
}
```

**Report encoding (type=1):**
```
encodeAbiParameters(
  "uint8, bytes32, address, address, address, address, uint256, uint256",
  [1, orderId, stealthBuyer, stealthSeller, tokenA, tokenB, tradeAmount, quoteAmount]
)
```

---

### `withdraw`

Processes a user withdrawal from the vault.

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

| Type | Name | Target | Encoding |
|---|---|---|---|
| 0 | verify | `WorldIDVerifierRegistry` | `(uint8, address user)` |
| 1 | settle | SSL vault | `(uint8, bytes32 orderId, address stealthBuyer, address stealthSeller, address tokenA, address tokenB, uint256 amountA, uint256 amountB)` |
| 2 | withdraw | SSL vault (primary chain) | `(uint8, address user, uint256 withdrawalId)` |

---

## Configuration (`config.staging.json`)

```json
{
  "authorizedEVMAddress": "0x<backend-signer-address>",
  "gasLimit": "300000",
  "worldIdVerifyUrl": "https://developer.worldcoin.org/api/v2/verify/<app-id>",
  "worldIdAction": "sslflow",
  "primaryChain": "ethSepolia",
  "chains": {
    "ethSepolia": {
      "chainId": 11155111,
      "chainSelector": "ethereum-testnet-sepolia",
      "vault": "0xE588a6c73933BFD66Af9b4A07d48bcE59c0D2d13",
      "forwarder": "0x15fC6ae953E024d975e77382eEeC56A9101f9F88",
      "worldIdRegistry": "0xb1eA4506e10e4Be8159ABcC7A7a67C614a13A425"
    }
  }
}
```

The `WorldIDVerifierRegistry` is deployed at `0xb1eA4506e10e4Be8159ABcC7A7a67C614a13A425`. The `isVerified` check reads from this address; the verify report (`type=0`) is also sent here so `onReport()` can set `isVerified[user] = true`.

---

## Setup

### 1. Configure environment

```bash
cd cre/verify-and-order-workflow
cp .env.example .env
# Set CRE_ETH_PRIVATE_KEY to a funded Sepolia private key
```

### 2. Install dependencies

```bash
bun install
```

### 3. Simulate locally

Run from the `cre/` directory:

```bash
cre workflow simulate verify-and-order-workflow --target=staging-settings --broadcast --non-interactive \
  --trigger-index 0 \
  --http-payload '{"action":"verify","nullifier_hash":"0x...","userAddress":"0x..."}'
```

### 4. Deploy to production

```bash
cre workflow deploy verify-and-order-workflow --target=staging-settings
```

Set `CRE_WORKFLOW_ID` in `backend/.env` and `NODE_ENV=production` to switch the backend from CLI simulation to the live CRE gateway.

---

## RPC Configuration (`project.yaml`)

Use public, non-rate-limited endpoints to avoid 429 errors during simulation:

```yaml
# Ethereum Sepolia
rpc-url: https://rpc.sepolia.org
```

Avoid rate-limited demo endpoints (e.g., `alchemy.com/v2/demo`).
