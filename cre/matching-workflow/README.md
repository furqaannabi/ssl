# SSL Matching Workflow — CRE TEE

Chainlink CRE workflow for confidential order matching. Runs inside a Trusted Execution Environment (TEE) where no operator can observe plaintext order data.

## What It Does

1. **Receives** a new encrypted order from the backend.
2. **Decrypts** it using the TEE-private secp256k1 key.
3. **Fetches** all open encrypted orders and the underlying `baseSymbol` from the backend's `/api/order/encrypted-book` endpoint.
4. **Decrypts** every resting order inside the TEE.
5. **Matches** using price-time priority (fully in-memory, invisible to operators).
6. 🔒 **Confidential price check**: parses the `baseSymbol` (e.g. `tAAPL` → `AAPL`) and fetches live market price from Finnhub via `ConfidentialHTTPClient` (API key fetched securely via `runtime.getSecret()`). Aborts match if the price-check fails.
7. **Checks** both buyer and seller `userAddress` (EOA, not shield address) against `WorldIDVerifierRegistry.isVerified()` on-chain. Aborts to `pending` if either party is unverified.
8. **Executes** Convergence private transfers (base token → buyer, quote token → seller) via shield addresses.
9. 🔒 **Encrypted settlement callback**: calls `POST /api/order/cre-settle` via `ConfidentialHTTPClient` with `encryptOutput: true` — settlement details are AES-GCM encrypted before leaving the enclave.

## Encryption Scheme

**ECIES** — secp256k1 ECDH + SHA-256 + AES-256-GCM

```
Ciphertext format: compressed_ephemeral_pubkey(33) | iv(12) | aes_gcm_ciphertext_with_tag
```

- **Frontend** encrypts orders with the CRE public key (fetched from `GET /api/order/cre-pubkey`).
- **CRE TEE** decrypts with the corresponding private key (`creDecryptionKey` in config; injected via `secrets.yaml` in production).
- Even the backend operator never sees plaintext order data.

## Matching Algorithm

Price-time priority:
- **BUY** order: matches the lowest-priced resting SELL at or below the bid price.
- **SELL** order: matches the highest-priced resting BUY at or above the ask price.

## HTTP Trigger Payload

```json
{
  "action": "match_order",
  "orderId": "backend-assigned-uuid",
  "pairId": "pair-uuid",
  "encryptedOrder": "<base64 ECIES ciphertext>",
  "signature": "<user ECDSA sig over encrypted payload>"
}
```

## Privacy Track Features

This workflow uses `ConfidentialHTTPClient` from `@chainlink/cre-sdk` for two privacy-critical operations:

### Feature A: Credential Isolation (Inbound Data)

The Finnhub API key is injected **only inside the TEE enclave** via `runtime.getSecret()` (compatible with Vault DON Secrets in production). The key never exists in node memory, logs, or network traffic.

If the Finnhub API fails, the match is safely aborted (`reason: "price_check_failed"`).

### Feature B: Response Encryption (Outbound Data)

The settlement callback uses `encryptOutput: true`, so trade details (amounts, tx IDs) are **AES-GCM encrypted before leaving the enclave**. The `X-CRE-Secret` header is also fetched securely via `runtime.getSecret()`.

## Settlement Callback

On a match, the TEE calls via **Confidential HTTP** (encrypted egress):

```
POST <backendUrl>/api/order/cre-settle
X-CRE-Secret: {{.callbackSecret}}  ← injected inside enclave
Content-Type: application/json

{
  "buyerOrderId": "uuid",
  "sellerOrderId": "uuid",
  "tradeAmount": "5.0",
  "quoteAmount": "1500.000000",
  "pairId": "uuid",
  "buyerTxId": "...",
  "sellerTxId": "..."
}
```

The backend updates DB order statuses after the CRE workflow has completed settlement via Convergence private transfers.

## WorldID Registry Check

Before calling the settlement callback, the TEE reads `isVerified(userAddress)` from the `WorldIDVerifierRegistry` on-chain (via `EVMClient.callContract`). This uses the **normal EOA address** from the decrypted order — not the shield address.

- If `worldIdRegistry` is not set in config, the check is skipped and settlement proceeds (allows operation before the registry is deployed).
- If either party is not verified, the workflow returns `{ status: "pending", reason: "buyer_not_verified" | "seller_not_verified" }` without calling the backend.

## Configuration (`config.staging.json`)

```json
{
  "authorizedEVMAddress": "0x<backend-signer-address>",
  "creEncryptionPublicKey": "<compressed secp256k1 pubkey hex>",
  "creDecryptionKey": "<secp256k1 private key hex — use secrets.yaml in production>",
  "backendUrl": "http://localhost:3001",
  "callbackSecret": "<shared secret>",
  "ethSepoliaChainSelector": "ethereum-testnet-sepolia",
  "worldIdRegistry": "0xb1eA4506e10e4Be8159ABcC7A7a67C614a13A425",
  "convergenceApiUrl": "https://convergence2026-token-api.cldev.cloud",
  "servicePrivateKey": "<EIP-712 signer key>",
  "finnhubSecretOwner": "<Vault DON secret owner address>",
  "callbackSecretOwner": "<Vault DON secret owner address>"
}
```

## Setup

```bash
cd cre/matching-workflow
bun install
```

### Simulate

Run from the `cre/` directory:

```bash
cre workflow simulate matching-workflow --target=staging-settings \
  --trigger-index 0 \
  --http-payload '{"action":"match_order","orderId":"test-id","pairId":"pair-id","encryptedOrder":"<base64>","signature":"0x..."}'
```

*(Note: Ensure your `.env` contains `FINNHUB_API_KEY` and `CRE_CALLBACK_SECRET` for local simulation).*

### Deploy to Production

```bash
cre workflow deploy matching-workflow --target=staging-settings
```
