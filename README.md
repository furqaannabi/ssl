# SSL - Stealth Settlement Layer

Private, sybil-resistant, **cross-chain** token settlement using **World ID**, **stealth addresses**, **Chainlink CRE**, and **Chainlink CCIP**.

## How It Works

```
User ──> Backend (order book + matching) ──> CRE (settlement reports) ──> Vault (on-chain, per chain)
         Vault ──> Backend (multi-chain event listener: balances, auto-create pairs)
         Vault ──CCIP──> CCIP Receiver (dest chain) ──> Dest Vault (accounting)
```

### Supported Chains

| Chain | Chain ID | CCIP Selector |
|---|---|---|
| Base Sepolia | 84532 | `10344971235874465080` |
| Arbitrum Sepolia | 421614 | `3478487238524512106` |

Chain constants (including LINK token addresses) live in `contracts/script/Config.sol` (`SSLChains` library) and `backend/addresses.json`.

### Phase 1: Identity Verification

```
User                    Backend                 CRE                     Vault
 │                        │                      │                       │
 │── World ID proof ────> │                      │                       │
 │                        │── HTTP {action:       │                       │
 │                        │   "verify",           │                       │
 │                        │   userAddress} ─────> │                       │
 │                        │                       │── verify proof via    │
 │                        │                       │   World ID cloud API  │
 │                        │                       │── report(type=0) ──> │
 │                        │                       │   encode(uint8=0,    │
 │                        │                       │    address user)     │
 │                        │                       │                      │── isVerified[user]
 │                        │                       │                      │   = true
 │ <── verified ────────  │                       │                       │
```

- Backend receives World ID proof from frontend (authenticated via SIWE session)
- CRE calls the World ID cloud API to verify the proof
- CRE sends `report(type=0, address user)` to vault via KeystoneForwarder
- Vault marks `isVerified[user] = true`

### Phase 2: Funding + Auto Pair Creation (Multi-Chain)

```
User                    Vault (any chain)       Backend Listener
 │                        │                       │
 │── fund(token, amount)─>│                       │
 │                        │── emit Funded ───────────> │
 │                        │                       │── track chainSelector
 │                        │                       │── upsert TokenBalance
 │                        │                       │   (per chain)
 │                        │                       │── auto-create TOKEN/USDC Pair
```

- User calls `fund(token, amount)` on the vault (requires `isVerified[msg.sender]`)
- Backend runs a **multi-chain listener** -- one WebSocket connection per chain with a deployed vault
- Each deposit is tracked with a `chainSelector`, so balances are per-user-per-token-per-chain
- New tokens automatically get a TOKEN/USDC trading pair created

### Phase 3: Order Submission

```
User                    Backend
 │── POST /api/order ──> │── create Order (PENDING)
 │ <── {orderId} ─────── │
 │── POST /confirm ────> │── activate -> OPEN
 │ <── SSE stream ─────  │── run matching engine
```

- Two-step: create order + confirm with auth cookie
- Orders include a `stealthAddress` (Ethereum address generated client-side) for private settlement
- Matching engine runs immediately on confirmation

### Phase 4: Settlement (Same-Chain & Cross-Chain)

**Same-chain settlement:**
```
Backend ──> CRE ──> report(type=1) ──> Vault
                                        │── transfer baseToken -> stealthBuyer
                                        │── transfer quoteToken -> stealthSeller
```

**Cross-chain settlement (CCIP programmable token transfer):**
```
Backend ──> CRE ──> report(type=3) ──> Source Vault ──CCIP(USDC + orderId/recipient)──> SSLCCIPReceiver (dest chain)
                                                                                          │
                                                                                          ├── transfers USDC to seller
                                                                                          └── calls Dest Vault.markSettled(orderId)
```

For cross-chain trades (e.g. buy Token X on Arbitrum using USDC on Base):
- CRE sends **one report** (type=3) to the source vault
- Source vault sends USDC + encoded `(orderId, recipient)` via CCIP to the **SSLCCIPReceiver** on the destination chain
- The receiver forwards USDC to the seller and calls the destination vault to mark the order settled
- CCIP fees are paid in LINK from the vault's balance

### Phase 5: Withdrawal

```
User ── requestWithdrawal ──> Vault ── event ──> Backend Listener ──> CRE
                              Vault <── report(type=2) ── CRE
                              Vault ── safeTransfer ──> User
```

### Report Types

| Type | Name | Encoding |
|---|---|---|
| 0 | verify | `(uint8, address user)` |
| 1 | settle | `(uint8, bytes32 orderId, address stealthBuyer, address stealthSeller, address tokenA, address tokenB, uint256 amountA, uint256 amountB)` |
| 2 | withdraw | `(uint8, address user, uint256 withdrawalId)` |
| 3 | crossChainSettle | `(uint8, bytes32 orderId, uint64 destChainSelector, address destReceiver, address recipient, address token, uint256 amount)` |

### What's On-Chain vs Off-Chain

| Data | Location | Visible? |
|---|---|---|
| User verified status | On-chain (vault) | Yes |
| Token deposits | On-chain (vault, per chain) | Yes |
| Trading pairs (Token, Pair) | Backend DB | No |
| Order book (prices, amounts, sides) | Backend DB (PostgreSQL) | No |
| Match logic | Backend (matching engine) | No |
| Stealth addresses | Frontend-generated | Not linked to user |
| Settlement transfers | On-chain (vault) | Stealth addresses only |
| Cross-chain bridges | On-chain (CCIP) | Yes, but stealth |
| User balances | Backend DB (per chain) | No |

## Architecture

| Component | Description |
|---|---|
| **contracts/** | Solidity -- `StealthSettlementVault`, `SSLCCIPReceiver`, `SSLChains` config library, `ReceiverTemplate`, interfaces, mocks |
| **cre/** | Chainlink CRE workflow -- World ID verification, settlement reports (same-chain + cross-chain) |
| **backend/** | Bun + Hono -- Auth, order book, matching engine, multi-chain vault listener, CRE bridge |
| **frontend/** | React + Vite trading terminal with World ID integration |

### Contracts

- **StealthSettlementVault** -- Holds deposited tokens. Deployed per chain. Accepts 4 report types from CRE via KeystoneForwarder (see table above). For cross-chain trades, initiates CCIP programmable token transfers of USDC + encoded data to the destination chain. CCIP fees paid in LINK.
- **SSLCCIPReceiver** -- Standalone CCIP receiver deployed per chain. Receives USDC + `(orderId, recipient)` via CCIP, forwards USDC to the seller, and calls the local vault to mark the order settled.
- **SSLChains** (`Config.sol`) -- Pure helper library with chain constants (CCIP selectors, router addresses, forwarder addresses). No deployment needed -- used by deploy scripts and referenced off-chain.
- **ReceiverTemplate** -- Abstract base that validates reports come from the trusted forwarder
- **ISSLVault** -- Vault interface (fund, requestWithdrawal, isVerified, settledOrders, events including `CrossChainSettled` and `TokenReleased`)

### CRE Workflow (`cre/verify-and-order-workflow/main.ts`)

Single HTTP trigger with three actions:

- `verify` -- Validates World ID proof via cloud API, writes verify report `(type=0)` to vault
- `settle_match` -- Receives matched order data from backend, writes settlement report(s) to vault. For cross-chain trades, sends one report (type=3) to the source vault which bridges USDC via CCIP to the destination chain's `SSLCCIPReceiver`.
- `withdraw` -- Receives withdrawal request, writes withdrawal report `(type=2)` to vault

### Backend (`backend/`)

Bun + Hono HTTP server with PostgreSQL (Prisma ORM):

- **Auth** (SIWE) -- `GET /api/auth/nonce/:address` + `POST /api/auth/login`
- **Verify** -- `POST /api/verify` -- Forwards World ID proof to CRE, streams via SSE
- **Orders** -- `POST /api/order` + `POST /api/order/:id/confirm` + `POST /api/order/:id/cancel` + `GET /api/order/book`
- **Pairs** -- `GET /api/pairs` -- Lists all trading pairs with token metadata
- **User** -- `GET /api/user/me` (profile + balances per chain) + `GET /api/user/orders`
- **Withdrawals** -- `POST /api/withdraw` + `GET /api/withdraw`
- **Multi-Chain Vault Listener** -- Watches on-chain events on **all chains with deployed vaults**:
  - `Funded` -- Upserts user, auto-creates Token + Pair, updates TokenBalance (chain-aware)
  - `WithdrawalRequested` -- Validates balance, deducts, forwards to CRE
- **Matching Engine** -- Price/time priority matching. On match: resolves token addresses and chain selectors, sends to CRE

#### Data Model (Prisma)

```
Token (address, name, symbol, decimals, chainSelector)
  └── Pair (baseTokenAddress, quoteTokenAddress)
        └── Order (pairId, amount, price, side, status, stealthAddress, userAddress)
User (address, name, isVerified, nonce)
  ├── Order[]
  ├── TokenBalance[] (token, balance, chainSelector)  ← per-chain
  ├── Withdrawal[] (withdrawalId, token, amount, status)
  ├── Transaction[] (type, token, amount, chainSelector)
  └── Session[]
```

#### Multi-Chain Configuration

All chain addresses are stored in `backend/addresses.json`:

```json
{
    "chains": {
        "baseSepolia": {
            "chainId": 84532,
            "chainSelector": "ethereum-testnet-sepolia-base-1",
            "ccipChainSelector": "10344971235874465080",
            "vault": "0x...",
            "usdc": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
            "link": "0xE4aB69C077896252FAFBD49EFD26B5D171A32410",
            "ccipRouter": "0xD3b06cEbF099CE7DA4AcCf578aaEBFDBd6e88a93",
            "forwarder": "0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5",
            "rpcUrl": "https://base-sepolia.g.alchemy.com/v2/",
            "wsUrl": "wss://base-sepolia.g.alchemy.com/v2/"
        },
        "arbitrumSepolia": { ... }
    }
}
```

The deploy script (`contracts/deploy.sh`) auto-populates this file after each deployment.

## Setup

### Prerequisites

- [Foundry](https://book.getfoundry.sh/) (forge, cast)
- [Bun](https://bun.sh/) (v1.2+)
- [CRE CLI](https://docs.chain.link/cre) (`cre`)
- PostgreSQL

### Contracts

```bash
cd contracts
forge install
forge build
forge test -vv
```

### Deploy (Multi-Chain)

```bash
cd contracts
./deploy.sh                     # deploy to all chains
CHAIN=baseSepolia ./deploy.sh   # deploy to Base Sepolia only
CHAIN=arbitrumSepolia ./deploy.sh  # deploy to Arb Sepolia only
```

The script:
1. Reads env from `backend/.env`
2. Runs `forge script` against each chain's RPC
3. Extracts deployed addresses from broadcast files
4. Writes `backend/addresses.json` and updates CRE config

Environment variables: `PRIVATE_KEY` (required), `FORWARDER_ADDRESS` / `CCIP_ROUTER` / `LINK_TOKEN` (optional overrides, auto-resolved from `SSLChains`). `LINK_FUND` controls how much LINK to seed the vault with (default 1 LINK).

### Backend

```bash
cd backend
cp .env.example .env   # configure EVM_PRIVATE_KEY, ALCHEMY_API_KEY, JWT_SECRET, DATABASE_URL
bun install
npx prisma migrate dev
bun run dev
```

### CRE Workflow

```bash
cd cre/verify-and-order-workflow
bun install
```

Simulate locally:

```bash
cd cre
cre workflow simulate verify-and-order-workflow --target=staging-settings
```

### Frontend

```bash
cd frontend
bun install
bun run dev
```

## Tech Stack

- **Solidity** (Foundry) -- Smart contracts (vault, config library, receiver, mocks)
- **Chainlink CRE** -- Off-chain confidential compute (verification, settlement reports)
- **Chainlink CCIP** -- Cross-chain token bridging for multi-chain settlement
- **World ID** (`@worldcoin/idkit`) -- Sybil-resistant identity verification
- **Stealth Addresses** -- Frontend-generated one-time addresses for private settlement
- **Bun + Hono** -- Backend HTTP server
- **PostgreSQL + Prisma** -- Order book, user data, per-chain token balances, trading pairs
- **ethers.js** -- Multi-chain event listening (vault deposits, withdrawals)
- **viem** -- ABI encoding, keccak256, signature verification
- **OpenZeppelin** -- SafeERC20, ReentrancyGuard, Ownable
- **React 19 + Vite + TailwindCSS** -- Frontend trading terminal

## License

MIT
