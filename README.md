# SSL — Stealth Settlement Layer

Private, sybil-resistant RWA token trading using **World ID**, **stealth addresses**, **Chainlink CRE**, and **Chainlink ACE** — deployed on **Ethereum Sepolia**.

## How It Works

```
User ──> Backend (order book + CRE matching) ──> Convergence Vault (on-chain settlement)
                                                           │
                              WorldIDVerifierRegistry ◄─── CRE TEE (World ID verify)
                                      │
                              WorldIDPolicy (ACE) ──> blocks unverified deposits
```

### Components

| Component | Description |
|---|---|
| **Compliant-Private-Transfer-Demo/** | Solidity contracts — `WorldIDVerifierRegistry`, `WorldIDPolicy` (ACE), deployment scripts |
| **cre/matching-workflow/** | CRE TEE — decrypts orders, runs private matching, calls Convergence API |
| **cre/verify-and-order-workflow/** | CRE TEE — verifies World ID proofs, sends on-chain reports to `WorldIDVerifierRegistry` |
| **backend/** | Bun + Hono — auth, order book, AI advisor, price feeds, CRE bridge |
| **frontend/** | React + Vite — trading terminal, World ID widget, AI chatbot |

---

## Architecture

### Chain

All contracts and vaults are on **Ethereum Sepolia** (chain ID 11155111).

### Convergence Vault

The private token vault is provided by the [Convergence API](https://convergence2026-token-api.cldev.cloud/). It holds deposited RWA tokens and USDC and executes settlement transfers.

- Vault address: `0xE588a6c73933BFD66Af9b4A07d48bcE59c0D2d13`
- Tokens are registered in the vault via `IVault.register(token, policyEngine)` with a per-token `PolicyEngine` proxy.

### Compliance (Chainlink ACE)

Every token in the vault has a `PolicyEngine` with a `WorldIDPolicy` attached. Before any `deposit()` call succeeds, the policy checks `WorldIDVerifierRegistry.isVerified(caller)` on-chain.

- **Unverified caller** → `deposit()` reverts: `PolicyRejected("World ID verification required to deposit")`
- **Verified caller** → deposit proceeds normally

### Phase 1 — Identity Verification

```
User                  Backend                  CRE TEE (verify-and-order-workflow)
 │                       │                               │
 │── World ID proof ────>│                               │
 │                       │── POST {action: "verify"} ───>│
 │                       │                               │── verify proof via World ID cloud API
 │                       │                               │── onReport(type=0, userAddress) ──>
 │                       │                               │         WorldIDVerifierRegistry
 │                       │                               │               │── isVerified[user] = true
 │ <── VERIFIED (SSE) ───│                               │
```

- Backend updates `User.isVerified = true` in DB after CRE confirms.
- On-chain registry is updated by the CRE TEE forwarder, not the backend.

### Phase 2 — Order Matching (Private)

```
User                  Backend                  CRE TEE (matching-workflow)
 │                       │                               │
 │── POST /api/order ───>│── encrypt(order, creKey)      │
 │  (isVerified required) │── POST {action: "match_order"}─>│
 │                       │                               │── decrypt incoming order (TEE only)
 │                       │                               │── fetch encrypted order book
 │                       │                               │── check isVerified(buyer) on-chain
 │                       │                               │── check isVerified(seller) on-chain
 │                       │                               │── match in-memory (invisible)
 │                       │                               │── POST /api/order/cre-settle ──>│
 │                       │ <── settlement callback        │                                │
 │                       │── Convergence API settleMatch()│
```

Orders are encrypted client-side with ECIES (secp256k1 + AES-256-GCM). Only the CRE TEE can decrypt them. Matching runs entirely inside the enclave — no operator can see plaintext order data.

The matching workflow checks `WorldIDVerifierRegistry.isVerified(userAddress)` on-chain for **both buyer and seller** before settlement proceeds. The backend `cre-settle` route also re-checks from the registry as a second guard.

### Phase 3 — Settlement

The CRE matching workflow calls back `POST /api/order/cre-settle` with the matched order details. The backend verifies both parties against the on-chain registry, then calls `settleMatch()` via the Convergence API, which executes the on-chain token transfer to shield addresses.

### Shield Addresses

Every order includes a **shield address** generated client-side — a fresh Ethereum address with no on-chain history linked to the user. Settlement transfers go to this address, so the on-chain record never reveals the real trader.

---

## Report Types (verify-and-order-workflow)

| Type | Name | Encoding |
|---|---|---|
| 0 | verify | `(uint8, address user)` — sent to `WorldIDVerifierRegistry` |
| 1 | settle | `(uint8, bytes32 orderId, address stealthBuyer, address stealthSeller, address tokenA, address tokenB, uint256 amountA, uint256 amountB)` |
| 2 | withdraw | `(uint8, address user, uint256 withdrawalId)` |

---

## Key Addresses (Ethereum Sepolia)

| Contract | Address |
|---|---|
| Convergence Vault | `0xE588a6c73933BFD66Af9b4A07d48bcE59c0D2d13` |
| CRE Forwarder | `0x15fC6ae953E024d975e77382eEeC56A9101f9F88` |
| USDC | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` |
| WorldIDVerifierRegistry | `0xb1eA4506e10e4Be8159ABcC7A7a67C614a13A425` |

---

## Whitelisted RWA Tokens

| Symbol | Name | Type |
|---|---|---|
| tMETA | Meta Platforms | STOCK |
| tGOOGL | Alphabet Inc. | STOCK |
| tAAPL | Apple Inc. | STOCK |
| tTSLA | Tesla Inc. | STOCK |
| tAMZN | Amazon.com | STOCK |
| tNVDA | NVIDIA Corp | STOCK |
| tSPY | S&P 500 ETF | ETF |
| tQQQ | Nasdaq 100 ETF | ETF |
| tBOND | US Treasury Bond | BOND |
| USDC | USD Coin | STABLE |

---

## Setup

### Prerequisites

- [Foundry](https://book.getfoundry.sh/) (for compliance contracts)
- [Bun](https://bun.sh/) v1.2+
- [CRE CLI](https://docs.chain.link/cre)
- PostgreSQL

### Compliance Contracts (Compliant-Private-Transfer-Demo)

```bash
cd Compliant-Private-Transfer-Demo
forge install
forge build --via-ir

export PRIVATE_KEY=<0xyour_private_key>
export RPC_URL=<eth_sepolia_rpc_url>

# Step 1: Register SSL tokens in the Convergence vault
forge script script/RegisterAllSSLTokens.s.sol \
  --rpc-url $RPC_URL --broadcast --private-key $PRIVATE_KEY

# Step 2: Deploy World ID compliance layer
forge script script/03_DeployWorldIDPolicy.s.sol \
  --rpc-url $RPC_URL --broadcast --private-key $PRIVATE_KEY
```

Copy the printed `WorldIDVerifierRegistry` address into:
- `cre/verify-and-order-workflow/config.staging.json` → `chains.ethSepolia.worldIdRegistry`
- `cre/matching-workflow/config.staging.json` → `worldIdRegistry`
- `backend/.env` → `WORLD_ID_REGISTRY`

The registry is already deployed at `0xb1eA4506e10e4Be8159ABcC7A7a67C614a13A425`.

### Backend

```bash
cd backend
cp .env.example .env   # set EVM_PRIVATE_KEY, DATABASE_URL, etc.
bun install
npx prisma migrate dev
bun run dev
```

### CRE Workflows

```bash
cd cre/matching-workflow && bun install
cd cre/verify-and-order-workflow && bun install
```

Simulate:
```bash
cre workflow simulate matching-workflow --target=staging-settings
cre workflow simulate verify-and-order-workflow --target=staging-settings
```

### Frontend

```bash
cd frontend && bun install && bun run dev
```

---

## Tech Stack

- **Solidity + Foundry** — WorldIDVerifierRegistry, WorldIDPolicy (Chainlink ACE)
- **Chainlink CRE** — Confidential order matching, World ID verification reports
- **Chainlink ACE** — On-chain compliance policy (WorldIDPolicy blocks unverified deposits)
- **Convergence API** — Private RWA token vault + settlement
- **World ID** — Sybil-resistant proof-of-humanity
- **Stealth Addresses** — Client-side one-time addresses for private settlement
- **Google Gemini 2.5 Flash** — AI financial advisor (OpenAI-compatible SDK)
- **Finnhub API** — Real-time stock/ETF price feeds
- **Bun + Hono** — Backend HTTP server
- **PostgreSQL + Prisma** — Order book, user data, trading pairs
- **viem** — ABI encoding, signature verification
- **React 19 + Vite + TailwindCSS** — Frontend trading terminal

---

## License

MIT
