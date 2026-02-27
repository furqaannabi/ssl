# SSL Backend

Bun + Hono HTTP server for the Stealth Settlement Layer. Handles authentication, World ID verification (via CRE), order book management, CRE order matching, Convergence API settlement, AI financial advisor, and real-time price feeds.

**Chain:** Ethereum Sepolia only.

---

## API Reference

### Authentication (SIWE)

#### Get Nonce
`GET /api/auth/nonce/:address`

```json
{ "nonce": "Sign this message to login to SSL: a1b2c3d4..." }
```

#### Login
`POST /api/auth/login`

```json
{ "address": "0x123...", "signature": "0xabc..." }
```

---

### User

#### Get Profile
`GET /api/user/me` *(auth required)*

Returns user details and token balances from the Convergence vault.

```json
{
  "success": true,
  "user": {
    "address": "0x123...",
    "isVerified": true,
    "balances": [
      { "token": "0xTokenA", "balance": "1000000000000000000", "chainSelector": "ethereum-testnet-sepolia" }
    ]
  }
}
```

#### Get User Orders
`GET /api/user/orders?status=OPEN` *(auth required)*

---

### World ID Verification

`POST /api/verify` *(auth required)*

Receives the World ID proof from the frontend, forwards it to the CRE `verify-workflow` via SSE stream. The CRE TEE verifies the proof and calls `onReport(type=0, userAddress)` on the `WorldIDVerifierRegistry` contract.

**Request:**
```json
{
  "nullifier_hash": "0x...",
  "merkle_root": "0x...",
  "proof": "0x...",
  "verification_level": "orb",
  "user_address": "0x123..."
}
```

**Response (SSE stream):**
```json
{"type": "log", "message": "Starting CRE verification..."}
{"type": "result", "success": true, "status": "VERIFIED"}
```

After CRE confirms, the backend sets `User.isVerified = true` in the DB. The on-chain `WorldIDVerifierRegistry` is updated by the CRE TEE forwarder, not the backend directly.

---

### Tokens

#### List All Tokens
`GET /api/tokens`

Returns all RWA tokens with real-time prices (Finnhub API or mock fallback).

#### Get Single Token
`GET /api/tokens/:symbol`

#### Get All Prices
`GET /api/tokens/prices/all`

#### Get Single Price
`GET /api/tokens/prices/:symbol`

---

### Trading Pairs

`GET /api/pairs`

One pair per RWA symbol (chain-agnostic). Includes base token addresses so the frontend can resolve deposit/withdrawal targets.

---

### Orders

#### Get Order Book
`GET /api/order/book`

#### Place Order
`POST /api/order` *(auth required, World ID verified)*

Requires `user.isVerified = true` in DB. Returns `403` if unverified.

Orders are encrypted with the CRE public key before submission. The CRE TEE decrypts and matches them inside the enclave.

```json
{
  "pairId": "pair-uuid",
  "amount": "100",
  "price": "50",
  "side": "BUY",
  "stealthAddress": "0x1234...",
  "userAddress": "0x123...",
  "encryptedPayload": "<base64 ECIES ciphertext>"
}
```

**Response (SSE stream):**
```json
{"type": "log", "message": "Order created. Sending to CRE matching workflow..."}
{"type": "result", "success": true, "status": "OPEN", "orderId": "order_new_123"}
```

#### CRE Settlement Callback
`POST /api/order/cre-settle` *(CRE-secret required)*

Called by the CRE matching workflow after a match. Before settling, the backend reads `isVerified(address)` from the `WorldIDVerifierRegistry` on-chain for **both buyer and seller**. Returns `403` if either party is unverified. If both are verified, calls `settleMatch()` on the Convergence API to execute the on-chain transfer to shield addresses.

#### Cancel Order
`POST /api/order/:id/cancel` *(auth required)*

---

### AI Financial Advisor

#### Chat (Streaming)
`POST /api/chat`

Google Gemini 2.5 Flash via OpenAI-compatible SDK. Streams financial advice with context: user portfolio, live market prices, order book, arbitrage opportunities.

```json
{ "message": "Any arbitrage opportunities?", "userAddress": "0x123...", "conversationHistory": [] }
```

#### Get Arbitrage Opportunities
`GET /api/chat/arbitrage`

#### Get Prices
`GET /api/chat/prices`

---

## Data Model (Prisma)

```
User (address, isVerified, nonce)
  ├── Order (pairId, amount, price, side, status, stealthAddress, encryptedPayload)
  ├── TokenBalance (token, balance, chainSelector)
  ├── Withdrawal (withdrawalId, token, amount, status)
  ├── Transaction (type, token, amount, chainSelector, txHash)
  └── Session[]

Token (address, name, symbol, decimals, chainSelector)
Pair (baseSymbol @unique)
```

Order lifecycle: `PENDING` → `OPEN` → `MATCHED` → `SETTLED` (or `CANCELLED`)

---

## Configuration

### Environment Variables

| Variable | Description | Required |
|---|---|---|
| `EVM_PRIVATE_KEY` | Backend signer — owns the `WorldIDVerifierRegistry` and signs Convergence API calls | Yes |
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `JWT_SECRET` | SIWE session secret | Yes |
| `CRE_CALLBACK_SECRET` | Shared secret for CRE → backend settlement callback (`X-CRE-Secret`) | Yes |
| `CRE_ENCRYPTION_KEY` | secp256k1 private key — TEE uses this to decrypt orders | Yes |
| `CONVERGENCE_API_URL` | Convergence API base URL | Yes |
| `OPENAI_API_KEY` | Google Gemini API key (via OpenAI-compatible endpoint) | AI chat |
| `AI_MODEL` | AI model ID (default: `gemini-2.5-flash`) | No |
| `FINNHUB_API_KEY` | Real-time stock/ETF prices | No (mock used if absent) |
| `WORLD_ID_REGISTRY` | `WorldIDVerifierRegistry` address — used to call `setVerified()` after World ID proof and to read `isVerified()` at settlement | Yes |

---

## Key Files

| File | Purpose |
|---|---|
| `src/routes/order.ts` | Order CRUD (isVerified gate), CRE settlement callback with on-chain registry check, encrypted book |
| `src/routes/verify.ts` | World ID proof → CRE stream → DB + on-chain registry update |
| `src/lib/world-id-registry.ts` | `markWorldIDVerified()` (write) + `checkWorldIDVerified()` (read) for `WorldIDVerifierRegistry` |
| `src/lib/convergence-client.ts` | Convergence API wrapper (EIP-712 signing, `settleMatch`, `deposit`, `withdraw`) |
| `src/lib/cre-client.ts` | Sends requests to CRE workflows |
| `src/lib/matching-engine.ts` | Local plaintext matching fallback (used if CRE unavailable) |
| `src/lib/config.ts` | Env config |
| `prisma/schema.prisma` | DB schema |
| `rwa-tokens.json` | ETH Sepolia token addresses for all 9 RWA tokens + USDC |
