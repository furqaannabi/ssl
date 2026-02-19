# SSL Backend API Documentation

Backend service for the Stealth Settlement Layer (SSL). Handles user authentication, World ID verification, order matching, multi-chain vault event listening, withdrawals, and CRE integration.

## Multi-Chain Architecture

The backend listens for vault events on **all chains with deployed vaults**. Chain configuration is loaded from `addresses.json`:

```json
{
  "chains": {
    "baseSepolia": {
      "chainId": 84532,
      "chainSelector": "ethereum-testnet-sepolia-base-1",
      "ccipChainSelector": "10344971235874465080",
      "vault": "0x...",
      "ccipReceiver": "0x...",
      "usdc": "0x...",
      "link": "0x...",
      "ccipRouter": "0x...",
      "forwarder": "0x...",
      "wsUrl": "wss://base-sepolia.g.alchemy.com/v2/"
    },
    "arbitrumSepolia": { ... }
  }
}
```

Token balances are tracked per-user, per-token, **per-chain** (`chainSelector` in `TokenBalance`). The vault listener spawns one WebSocket connection per active chain and tags all deposits/withdrawals with the chain they occurred on.

---

## Authentication

The backend uses **SIWE (Sign-In with Ethereum)** and **HttpOnly Cookies** for authentication.

### 1. Get Nonce
**GET** `/api/auth/nonce/:address`

**Response:**
```json
{
  "nonce": "Sign this message to login to SSL: a1b2c3d4..."
}
```

### 2. Login
**POST** `/api/auth/login`

**Request:**
```json
{
  "address": "0x123...",
  "signature": "0xabc..."
}
```

**Response:**
```json
{ "success": true }
```

---

## User Profile

### Get Current User
**GET** `/api/user/me` *(Requires Auth Cookie)*

Returns user details and token balances across all chains.

**Response:**
```json
{
  "success": true,
  "user": {
    "address": "0x123...",
    "isVerified": true,
    "balances": [
      { "token": "0xTokenA", "balance": "1000000000000000000", "chainSelector": "ethereum-testnet-sepolia-base-1" },
      { "token": "0xTokenB", "balance": "500000000", "chainSelector": "ethereum-testnet-sepolia-arbitrum-1" }
    ]
  }
}
```

### Get User Orders
**GET** `/api/user/orders?status=OPEN` *(Requires Auth Cookie)*

---

## Verification

### Verify World ID
**POST** `/api/verify` *(Requires Auth Cookie)*

**Request:**
```json
{
  "nullifier_hash": "0x...",
  "merkle_root": "0x...",
  "proof": "0x...",
  "credential_type": "orb",
  "verification_level": "orb",
  "user_address": "0x123..."
}
```

**Response (SSE Stream):**
```json
{"type": "log", "message": "Starting CRE verification..."}
{"type": "result", "success": true, "status": "VERIFIED"}
```

---

## Trading Pairs

### List Pairs
**GET** `/api/pairs`

Returns all trading pairs. Pairs are auto-created when new tokens are deposited into any vault.

**Response:**
```json
{
  "success": true,
  "pairs": [
    {
      "id": "pair-uuid",
      "baseToken": { "symbol": "TBILL", "address": "0x...", "decimals": 18, "chainSelector": "ethereum-testnet-sepolia-base-1" },
      "quoteToken": { "symbol": "USDC", "address": "0x...", "decimals": 6, "chainSelector": "ethereum-testnet-sepolia-base-1" }
    }
  ]
}
```

---

## Order Management

### Get Orderbook
**GET** `/api/order/book`

### Place Order
**POST** `/api/order` *(Requires Auth Cookie)*

**Request:**
```json
{
  "pairId": "pair-uuid",
  "amount": "100",
  "price": "50",
  "side": "BUY",
  "stealthAddress": "0x1234567890abcdef1234567890abcdef12345678",
  "userAddress": "0x123..."
}
```

**Response (SSE Stream):**
```json
{"type": "log", "message": "Order created. Starting matching engine..."}
{"type": "result", "success": true, "status": "OPEN", "orderId": "order_new_123"}
```

### Cancel Order
**POST** `/api/order/:id/cancel` *(Requires Auth Cookie)*

---

## Withdrawals

### Request Withdrawal
**POST** `/api/withdraw` *(Requires Auth Cookie)*

Deducts internal balance, forwards to CRE for on-chain settlement, streams progress. On CRE failure the balance is auto-refunded.

**Request:**
```json
{
  "token": "0xTokenA",
  "amount": "1000000000000000000",
  "withdrawalId": "42"
}
```

**Response (SSE Stream):**
```json
{"type": "log", "message": "Balance deducted. Forwarding withdrawal to CRE..."}
{"type": "result", "success": true, "withdrawalId": "42", "status": "COMPLETED"}
```

### List Withdrawals
**GET** `/api/withdraw?status=COMPLETED` *(Requires Auth Cookie)*

---

## Transaction History

### Get Unified History
**GET** `/api/history` *(Requires Auth Cookie)*

Returns merged, chronologically-sorted orders and on-chain transactions. Each transaction includes a `chainSelector` indicating which chain it occurred on.

---

## Price Oracle

### Get Prices
**GET** `/api/oracle/prices`

Returns simulated live market prices for supported assets.

---

## Compliance Dashboard

### Get Stats
**GET** `/api/compliance/stats`

Returns system-wide compliance metrics: verified user count, ZKP proof stats, and audit log.

---

## Multi-Chain Vault Listener

The backend runs WebSocket listeners for **every chain with a vault in `addresses.json`**:

- **`Funded`** -- Auto-creates user, token, and trading pair records; updates internal balances tagged with `chainSelector`; records a `DEPOSIT` transaction.
- **`WithdrawalRequested`** -- Validates sufficient balance on the correct chain, atomically deducts balance, forwards to CRE. Skips withdrawals already handled by `/api/withdraw`.
- **`Settled`** -- Records same-chain settlement in the `Settlement` table.
- **`CrossChainSettled`** -- Records CCIP bridge initiation (status: `BRIDGING`) with the CCIP message ID.
- **`TokenReleased`** -- Emitted by the destination chain's `SSLCCIPReceiver` when bridged tokens are auto-released to the recipient. Marks settlement as `COMPLETED`.

Each listener reconnects automatically on connection drops (5s backoff).

---

## Data Model (Prisma)

```
Token (address, name, symbol, decimals, chainSelector)
  └── Pair (baseTokenAddress, quoteTokenAddress)
        └── Order (pairId, amount, price, side, status, stealthAddress, userAddress)

User (address, name, isVerified, nonce)
  ├── Order[]
  ├── TokenBalance[] (token, balance, chainSelector)   ← @@unique([userAddress, token, chainSelector])
  ├── Withdrawal[] (withdrawalId, token, amount, status)
  ├── Transaction[] (type, token, amount, chainSelector, txHash)
  └── Session[]
```

Order lifecycle: `PENDING` -> `OPEN` -> `MATCHED` -> `SETTLED` (or `CANCELLED`)
Withdrawal lifecycle: `PENDING` -> `PROCESSING` -> `COMPLETED` | `FAILED`

---

## Configuration

### addresses.json

Multi-chain address registry, auto-populated by `contracts/deploy.sh`. Contains per-chain vault, CCIP receiver, USDC, LINK, CCIP router, forwarder, and RPC/WS URLs.

### contracts.json (Legacy)

Single-chain backwards-compat file with `vault`, `bond`, `usdc` for Base Sepolia. Still read by `config.ts` for legacy references.

### Environment Variables

| Variable | Description |
|---|---|
| `EVM_PRIVATE_KEY` | Backend signer private key |
| `ALCHEMY_API_KEY` | Alchemy API key (used for all chain WS URLs) |
| `JWT_SECRET` | Secret for SIWE session tokens |
| `DATABASE_URL` | PostgreSQL connection string |
| `CRE_GATEWAY_URL` | Production CRE gateway (optional) |
| `CRE_WORKFLOW_ID` | Production CRE workflow ID (optional) |
