# SSL Backend API Documentation

This directory contains the backend service for the Stealth Settlement Layer (SSL). It handles user authentication, World ID verification, order matching via the Chainlink CRE, withdrawals, transaction history, a mock price oracle, and compliance reporting.

## Authentication

The backend uses **SIWE (Sign-In with Ethereum)** and **HttpOnly Cookies** for authentication.

### 1. Get Nonce
**GET** `/api/auth/nonce/:address`

Generates a random nonce for the user to sign.

**Response:**
```json
{
  "nonce": "Sign this message to login to SSL: a1b2c3d4..."
}
```

### 2. Login
**POST** `/api/auth/login`

Verifies the signature and sets a secure `token` cookie.

**Request:**
```json
{
  "address": "0x123...",
  "signature": "0xabc..."
}
```

**Response:**
```json
{
  "success": true
}
```
*Note: A `token` cookie is set in the response headers (HttpOnly, Secure).*

---

## User Profile

### Get Current User
**GET** `/api/user/me`
*(Requires Auth Cookie)*

Returns user details and token balances.

**Response:**
```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "address": "0x123...",
    "isVerified": true,
    "balances": [
        { "token": "0xTokenA", "balance": "1000000000000000000" }
    ]
  }
}
```
*Note: If `isVerified` is false locally, the server checks the `SSLVault` smart contract. If verified on-chain, it updates the database and returns `true`.*

### Get User Orders
**GET** `/api/user/orders?status=OPEN`
*(Requires Auth Cookie)*

Returns orders created by the user. Optional `status` filter.

**Response:**
```json
{
  "success": true,
  "orders": [
    {
      "id": "order_1",
      "pairId": "pair-uuid",
      "amount": "100",
      "status": "OPEN",
      "createdAt": "2024-..."
    }
  ]
}
```

---

## Verification

### Verify World ID
**POST** `/api/verify`
*(Requires Auth Cookie)*

Submits a World ID proof. The server validates it and streams the verification progress from the CRE.

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
{"type": "log", "message": "Proof verified on-chain..."}
{"type": "result", "success": true, "status": "VERIFIED"}
```

---

## Trading Pairs

### List Pairs
**GET** `/api/pairs`

Returns all available trading pairs with token metadata. Pairs are auto-created when a new token is deposited into the vault.

**Response:**
```json
{
  "success": true,
  "pairs": [
    {
      "id": "pair-uuid",
      "baseTokenAddress": "0xTokenA",
      "quoteTokenAddress": "0xUSDC",
      "baseToken": { "symbol": "TBILL", "name": "T-Bill Token", "address": "0xTokenA", "decimals": 18 },
      "quoteToken": { "symbol": "USDC", "name": "USD Coin", "address": "0xUSDC", "decimals": 6 }
    }
  ]
}
```

---

## Order Management

### Get Orderbook
**GET** `/api/order/book`

Returns all `OPEN` orders.

**Response:**
```json
{
  "success": true,
  "orders": [
    {
      "id": "order_abc",
      "side": "BUY",
      "price": "1500",
      "amount": "1.5"
    }
  ]
}
```

### Place Order
**POST** `/api/order`
*(Requires Auth Cookie)*

Creates an order and streams the matching engine logs. The `stealthAddress` is a standard Ethereum address (0x + 40 hex chars) generated client-side for privacy-preserving settlement.

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
**POST** `/api/order/:id/cancel`
*(Requires Auth Cookie)*

Cancels an `OPEN` order.

**Response:**
```json
{
  "success": true,
  "orderId": "order_123",
  "status": "CANCELLED"
}
```

---

## Withdrawals

### Request Withdrawal
**POST** `/api/withdraw`
*(Requires Auth Cookie)*

Processes a withdrawal after the user has called `requestWithdrawal` on-chain. Deducts the internal balance, forwards to the CRE for on-chain settlement, and streams progress. On CRE failure the balance is automatically refunded.

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
{"type": "log", "message": "CRE processing..."}
{"type": "result", "success": true, "withdrawalId": "42", "status": "COMPLETED"}
```

Withdrawal statuses: `PENDING` -> `PROCESSING` -> `COMPLETED` | `FAILED`

### List Withdrawals
**GET** `/api/withdraw?status=COMPLETED`
*(Requires Auth Cookie)*

Returns the authenticated user's withdrawals. Optional `status` filter (`PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`).

**Response:**
```json
{
  "success": true,
  "withdrawals": [
    {
      "id": "uuid",
      "withdrawalId": "42",
      "userAddress": "0x123...",
      "token": "0xTokenA",
      "amount": "1000000000000000000",
      "status": "COMPLETED",
      "txHash": null,
      "createdAt": "2024-...",
      "updatedAt": "2024-..."
    }
  ]
}
```

---

## Transaction History

### Get Unified History
**GET** `/api/history`
*(Requires Auth Cookie)*

Returns a merged, chronologically-sorted list of the user's orders and on-chain transactions (deposits & withdrawals). Limited to the 50 most recent of each type.

**Response:**
```json
{
  "success": true,
  "history": [
    {
      "id": "uuid",
      "type": "ORDER",
      "side": "BUY",
      "status": "OPEN",
      "asset": "TBILL/USDC",
      "amount": "100",
      "price": "50",
      "filled": "0",
      "hash": "0x1234...5678",
      "createdAt": "2024-..."
    },
    {
      "id": "uuid",
      "type": "DEPOSIT",
      "side": "IN",
      "status": "COMPLETED",
      "asset": "0xTokenA",
      "amount": "1000000000000000000",
      "price": "-",
      "filled": "1000000000000000000",
      "hash": "0xabcd...ef01",
      "createdAt": "2024-..."
    }
  ]
}
```

---

## Price Oracle

### Get Prices
**GET** `/api/oracle/prices`

Returns simulated live market prices for supported assets. Uses sine-wave oscillation + random noise around base prices.

**Response:**
```json
{
  "success": true,
  "prices": {
    "BOND": { "symbol": "BOND", "price": "100.03", "change24h": "0.03%", "trend": "UP" },
    "USDC": { "symbol": "USDC", "price": "1.00", "change24h": "0.00%", "trend": "FLAT" },
    "TBILL": { "symbol": "TBILL", "price": "98.47", "change24h": "0.02%", "trend": "UP" },
    "BTC": { "symbol": "BTC", "price": "64250.00", "change24h": "0.08%", "trend": "UP" },
    "ETH": { "symbol": "ETH", "price": "3465.00", "change24h": "0.43%", "trend": "UP" },
    "SOL": { "symbol": "SOL", "price": "145.50", "change24h": "0.34%", "trend": "UP" }
  }
}
```

---

## Compliance Dashboard

### Get Stats
**GET** `/api/compliance/stats`

Returns system-wide compliance metrics: verified user count, ZKP proof stats, and a unified audit log of recent orders and transactions.

**Response:**
```json
{
  "success": true,
  "stats": {
    "oracleLastUpdate": "2024-01-01T00:00:00.000Z",
    "totalVerifiedUsers": 12,
    "zkpPending": 3,
    "zkpCompleted": 47,
    "logs": [
      {
        "time": "2024-...",
        "event": "Order BUY TBILL",
        "hash": "0x1234...",
        "status": "LOGGED",
        "color": "yellow"
      },
      {
        "time": "2024-...",
        "event": "DEPOSIT 0xTo...",
        "hash": "0xabcd...",
        "status": "CONFIRMED",
        "color": "primary"
      }
    ]
  }
}
```

---

## Vault Listener

The backend runs a WebSocket listener (`ssl-vault-listener`) that watches the `SSLVault` contract on Base Sepolia for:

- **`Funded`** — Auto-creates user, token, and trading pair records; updates internal balances; records a `DEPOSIT` transaction.
- **`WithdrawalRequested`** — Validates sufficient balance, atomically deducts balance + creates a `Withdrawal` record, records a `WITHDRAWAL` transaction, and forwards to the CRE. Skips withdrawals already handled by the `/api/withdraw` endpoint to prevent double-processing.
