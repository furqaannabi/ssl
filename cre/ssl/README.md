# SSL — Stealth Settlement Layer (CRE Workflow)

Confidential trading workflow powered by Chainlink CRE. Verified humans submit private orders via HTTP, CRE matches them off-chain, and settlement is delivered to one-time stealth addresses.

## Flow

1. User verifies identity via World ID (zero-knowledge, no PII)
2. User generates stealth keypair locally (private key never leaves client)
3. User submits order via HTTP trigger with World ID proof + stealth public key
4. CRE verifies World ID proof and checks nullifier uniqueness
5. CRE stores order in confidential memory (not visible on-chain)
6. CRE matches counterparties privately
7. CRE generates stealth settlement addresses from public keys
8. CRE triggers `vault.settle()` — funds sent to stealth addresses
9. User withdraws from stealth address using private key

## Setup

### 1. Set environment

```
CRE_ETH_PRIVATE_KEY=<your-funded-private-key>
```

### 2. Install dependencies

```bash
cd ssl && bun install
```

### 3. Update config

Edit `config.staging.json` with deployed contract addresses:

```json
{
  "vaultAddress": "<StealthSettlementVault address>",
  "chainSelector": "16015286601757825753",
  "authorizedEVMAddress": "<your EVM address authorized to trigger>"
}
```

Token addresses (`asset` and `quoteToken`) are provided by users per order via HTTP payload.

### 4. Simulate

From the project root (`cre/`):

**Submit a sell order (from file):**

```bash
cre workflow simulate ./ssl --non-interactive --trigger-index 0 --http-payload test-sell-order.json --target staging-settings
```

**Submit a buy order (inline):**

```bash
cre workflow simulate ./ssl --non-interactive --trigger-index 0 --http-payload '{"worldIdProof":"zk_proof_buyer","nullifierHash":"0xdef456","asset":"0xBondToken","quoteToken":"0xUSDC","amount":"1005000000000","price":"10050","side":"BUY","stealthPublicKey":"buyer_pub_key"}' --target staging-settings
```

**Interactive mode:**

```bash
cre workflow simulate ./ssl --target staging-settings
```

### HTTP Payload Format

```json
{
  "worldIdProof": "zk_proof_...",
  "nullifierHash": "0x...",
  "asset": "0xBondTokenAddress",
  "quoteToken": "0xUSDCAddress",
  "amount": "10000000000000000000000",
  "price": "10050",
  "side": "SELL",
  "stealthPublicKey": "stealth_pub_key_..."
}
```

| Field | Description |
|-------|-------------|
| `worldIdProof` | Zero-knowledge proof from World ID |
| `nullifierHash` | Unique hash preventing double-participation |
| `asset` | Token address to trade |
| `quoteToken` | Settlement token address |
| `amount` | Token amount (in smallest unit) |
| `price` | Price in cents (e.g. 10050 = $100.50) |
| `side` | `"BUY"` or `"SELL"` |
| `stealthPublicKey` | User's one-time stealth public key |
