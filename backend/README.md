# SSL Backend API Documentation

This directory contains the backend service for the Stealth Settlement Layer (SSL). It handles user authentication, World ID verification, and order matching via the Chainlink CRE.

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

Creates an order and streams the matching engine logs.

**Request:**
```json
{
  "pairId": "pair-uuid",
  "amount": "100",
  "price": "50",
  "side": "BUY",
  "stealthPublicKey": "0x...",
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
