# SSL - Stealth Settlement Layer

Private, sybil-resistant token settlement using **World ID**, **stealth addresses**, and **Chainlink CRE**.

## How It Works

```
User ──> Backend (order book + matching) ──> CRE (stealth addresses + settlement) ──> Vault (on-chain)
         Vault ──> Backend (event listener: balances, auto-create pairs)
```

### Phase 1: Identity Verification

```
User                    Backend                 CRE                     Vault
 │                        │                      │                       │
 │── World ID proof ────> │                      │                       │
 │   (nullifier, proof,   │                      │                       │
 │    merkle_root,        │                      │                       │
 │    userAddress)        │                      │                       │
 │                        │── HTTP {action:       │                       │
 │                        │   "verify",           │                       │
 │                        │   userAddress,        │                       │
 │                        │   proof, ...} ──────> │                       │
 │                        │   (signed JWT)        │                       │
 │                        │                       │── verify proof via    │
 │                        │                       │   World ID cloud API  │
 │                        │                       │                       │
 │                        │                       │── report(type=0) ──> │
 │                        │                       │   encode(uint8=0,    │
 │                        │                       │    address user)     │
 │                        │                       │                      │── isVerified[user]
 │                        │                       │                      │   = true
 │                        │                       │                      │── emit Verified(user)
 │                        │ <── {status:verified} │                       │
 │ <── verified ────────  │                       │                       │
```

- Backend receives World ID proof from frontend (authenticated via SIWE session)
- Backend signs and forwards proof to CRE as JWT-authenticated HTTP payload
- CRE calls the World ID cloud API to verify the proof
- CRE encodes `(uint8 reportType=0, address user)` and submits via `runtime.report()`
- KeystoneForwarder delivers report to vault -> `_processVerify()`
- Vault marks `isVerified[user] = true`

### Phase 2: Funding + Auto Pair Creation

```
User                    Vault                   Backend Listener
 │                        │                       │
 │── approve(vault, amt)─>│                       │
 │── fund(token, amount)─>│                       │
 │                        │── require(             │
 │                        │   isVerified[sender]) │
 │                        │── safeTransferFrom(    │
 │                        │   user, vault, amount) │
 │                        │── emit Funded(token,   │
 │                        │   amount, user) ─────────> │
 │                        │                       │── upsert User
 │                        │                       │── if new token:
 │                        │                       │     fetch ERC20 metadata
 │                        │                       │     (name, symbol, decimals)
 │                        │                       │     create Token record
 │                        │                       │     create TOKEN/USDC Pair
 │                        │                       │── update TokenBalance
```

- User calls `fund(token, amount)` on the vault directly (no nullifier needed)
- Vault checks `isVerified[msg.sender]` (set in Phase 1) and pulls tokens
- Backend listens for `Funded` events on-chain via ethers.js
- On first deposit of a new token, the listener:
  - Fetches ERC20 metadata (`name()`, `symbol()`, `decimals()`) from the contract
  - Creates a `Token` record in the database
  - Creates a `TOKEN/USDC` trading `Pair` (auto-paired against USDC)
- Updates the user's `TokenBalance` in the database
- New pairs immediately appear in the frontend trading pair dropdown via `GET /api/pairs`

### Phase 3: Order Submission (Two-Step)

```
User                    Backend
 │                        │
 │── POST /api/order ───> │
 │   {pairId, amount,     │── validate pairId exists
 │    price, side,        │── create Order (PENDING)
 │    stealthPublicKey,   │
 │    userAddress}        │
 │ <── {orderId,          │
 │      messageToSign} ── │
 │                        │
 │── sign(orderId) ─────> │  (EOA wallet signature)
 │                        │
 │── POST /api/order/     │
 │   :id/confirm ───────> │── verify auth cookie
 │   (auth cookie)        │── verify ownership
 │                        │── update status -> OPEN
 │                        │── run matching engine
 │ <── SSE stream ─────── │   (streamed logs)
```

- **Step 1**: User sends order with `pairId`, amount, price, side, and stealth public key
  - Backend validates the pair exists and creates a `PENDING` order in PostgreSQL
  - Returns an `orderId` for the user to sign
- **Step 2**: User signs the order ID with their EOA and calls confirm (authenticated via SIWE session cookie)
  - Backend verifies ownership, activates order to `OPEN`
  - Immediately runs the matching engine and streams progress via SSE
- Order data (pair, price, amount, side) is stored in the backend database, never on-chain

### Phase 4: Matching + Settlement

```
Backend                                         CRE                     Vault
 │                                                │                       │
 │── matchOrders()                                │                       │
 │   find opposite side where:                    │                       │
 │     same pairId                                │                       │
 │     buy.price >= sell.price                    │                       │
 │   (price/time priority)                        │                       │
 │                                                │                       │
 │── update both -> MATCHED                       │                       │
 │── resolve pair -> baseTokenAddress,            │                       │
 │                   quoteTokenAddress             │                       │
 │                                                │                       │
 │── HTTP {action: "settle_match",                │                       │
 │    baseTokenAddress, quoteTokenAddress,         │                       │
 │    buyer: {orderId, stealthPubKey, ...},        │                       │
 │    seller: {orderId, stealthPubKey, ...}} ───> │                       │
 │                                                │                       │
 │                                                │── tradeNonce =        │
 │                                                │   keccak256(buyerId   │
 │                                                │   + sellerId)         │
 │                                                │                       │
 │                                                │── ECDH stealth:       │
 │                                                │   r = keccak256(      │
 │                                                │     nonce+"_buyer")   │
 │                                                │   shared = r * S      │
 │                                                │   stealthPub =        │
 │                                                │     S + hash(shared)*G│
 │                                                │   stealthAddr =       │
 │                                                │     addr(stealthPub)  │
 │                                                │                       │
 │                                                │── orderId = keccak256(│
 │                                                │   nonce + stealth     │
 │                                                │   buyer + seller)     │
 │                                                │                       │
 │                                                │── report(type=1) ──> │
 │                                                │   encode(uint8=1,    │
 │                                                │   orderId,           │── require(!settled
 │                                                │   stealthBuyer,      │   Orders[orderId])
 │                                                │   stealthSeller,     │── safeTransfer(
 │                                                │   baseToken,         │   baseToken ->
 │                                                │   quoteToken,        │   stealthBuyer)
 │                                                │   amountA, amountB)  │── safeTransfer(
 │                                                │                      │   quoteToken ->
 │                                                │                      │   stealthSeller)
 │                                                │                      │── settledOrders
 │                                                │                      │   [orderId] = true
 │ <── settlement result ────────────────────────  │                      │── emit Settled
 │── update both -> SETTLED                       │                       │
```

- **Matching** happens in the backend (`matching-engine.ts`), not CRE
  - Finds opposite-side orders on the same `pairId` with compatible prices
  - Buy orders: matched with lowest sell price where `sell.price <= buy.price`
  - Sell orders: matched with highest buy price where `buy.price >= sell.price`
- On match: backend resolves the pair's `baseTokenAddress` and `quoteTokenAddress` from the database
- Backend forwards `{action: "settle_match", ...}` to CRE with resolved token addresses and stealth public keys
- **CRE** handles the cryptographic settlement:
  - Computes deterministic `tradeNonce` from both order IDs
  - Derives one-time **stealth addresses** via ECDH (EIP-5564 style, secp256k1) for both buyer and seller
  - Computes unique `orderId` hash to prevent replay
  - Encodes `(uint8=1, orderId, stealthBuyer, stealthSeller, baseToken, quoteToken, amountA, amountB)`
  - Sends signed report via KeystoneForwarder to vault
- **Vault** executes settlement: transfers `baseToken` to stealth buyer, `quoteToken` to stealth seller
- Neither party's real wallet appears in the settlement transaction

### Phase 5: Withdrawal

```
User                    Vault                   Backend Listener        CRE
 │                        │                       │                      │
 │── requestWithdrawal(   │                       │                      │
 │   token, amount) ────> │                       │                      │
 │                        │── withdrawalId++      │                      │
 │                        │── store request       │                      │
 │                        │── emit Withdrawal     │                      │
 │                        │   Requested(user,     │                      │
 │                        │   amount, id, ts) ──────> │                  │
 │                        │                       │── check balance      │
 │                        │                       │── deduct from        │
 │                        │                       │   TokenBalance       │
 │                        │                       │── sendToCRE({        │
 │                        │                       │   action:"withdraw", │
 │                        │                       │   withdrawalId,      │
 │                        │                       │   userAddress,       │
 │                        │                       │   amount, token}) ────> │
 │                        │                       │                      │── report(type=2)
 │                        │ <───────────────────────────────────────────── │
 │                        │── verify withdrawalId │                      │
 │                        │── mark claimed        │                      │
 │                        │── safeTransfer(        │                      │
 │                        │   token -> user)       │                      │
 │                        │── emit Withdrawal     │                      │
 │                        │   Claimed             │                      │
```

- User calls `requestWithdrawal(token, amount)` on the vault
- Backend listener catches the `WithdrawalRequested` event
- Listener verifies the user has sufficient balance in the database and deducts it
- Forwards the withdrawal to CRE, which sends `report(type=2)` to the vault
- Vault marks the request as claimed and transfers tokens to the user

### What's On-Chain vs Off-Chain

| Data | Location | Visible? |
|---|---|---|
| User verified status | On-chain (vault) | Yes |
| Token deposits | On-chain (vault) | Yes |
| Trading pairs (Token, Pair) | Backend DB | No |
| Order book (prices, amounts, sides) | Backend DB (PostgreSQL) | No |
| Match logic | Backend (matching engine) | No |
| Stealth address derivation | CRE (off-chain) | No |
| Settlement transfers | On-chain (vault) | Stealth addresses only |
| Link between user wallet and stealth address | Nowhere | No |
| User balances | Backend DB | No |
| Withdrawal requests | On-chain (vault) | Yes |

## Architecture

| Component | Description |
|---|---|
| **contracts/** | Solidity -- `StealthSettlementVault`, `ReceiverTemplate`, interfaces, mocks |
| **cre/** | Chainlink CRE workflow -- World ID verification, stealth address generation, on-chain settlement reports |
| **backend/** | Bun + Hono -- Auth, order book, matching engine, vault event listener, CRE bridge |
| **frontend/** | React + Vite trading terminal with World ID integration |

### Contracts

- **StealthSettlementVault** -- Holds deposited tokens. Accepts three report types from CRE via `KeystoneForwarder`:
  - `type 0` (verify) -- Marks a user address as verified: `(uint8, address user)`
  - `type 1` (settle) -- Transfers tokens to stealth addresses: `(uint8, bytes32 orderId, address stealthBuyer, address stealthSeller, address tokenA, address tokenB, uint256 amountA, uint256 amountB)`
  - `type 2` (withdraw) -- Claims a pending withdrawal: `(uint8, address user, uint256 withdrawalId)`
- **ReceiverTemplate** -- Abstract base that validates reports come from the trusted forwarder
- **ISSLVault** -- Vault interface (fund, requestWithdrawal, isVerified, settledOrders, events)
- **Mocks** -- `MockBondToken`, `MockUSDC` for testing

### CRE Workflow (`cre/verify-and-order-workflow/main.ts`)

Single HTTP trigger with three actions:

- `verify` -- Validates World ID proof via cloud API, then writes verify report `(type=0, user)` to vault
- `settle_match` -- Receives matched order data from backend, derives ECDH stealth addresses (EIP-5564 style via `@noble/curves` secp256k1), writes settlement report `(type=1)` to vault
- `withdraw` -- Receives withdrawal request from backend, writes withdrawal report `(type=2)` to vault

### Backend (`backend/`)

Bun + Hono HTTP server with PostgreSQL (Prisma ORM):

- **Auth** (SIWE) -- `GET /api/auth/nonce/:address` + `POST /api/auth/login` -- Sign-in with Ethereum, JWT in HttpOnly cookie
- **Verify** -- `POST /api/verify` -- Forwards World ID proof to CRE, streams progress via SSE
- **Orders** -- `POST /api/order` (create PENDING) + `POST /api/order/:id/confirm` (activate + match) + `POST /api/order/:id/cancel` + `GET /api/order/book`
- **Pairs** -- `GET /api/pairs` -- Lists all trading pairs with token metadata
- **User** -- `GET /api/user/me` (profile + balances) + `GET /api/user/orders` (order history)
- **Health** -- `GET /api/health` -- Server status and signer address
- **Vault Listener** -- Watches on-chain events:
  - `Funded` -- Upserts user, auto-creates Token + TOKEN/USDC Pair on first deposit, updates TokenBalance
  - `WithdrawalRequested` -- Validates balance, deducts, forwards to CRE for on-chain claim
- **Matching Engine** -- Price/time priority matching by `pairId`. On match: resolves pair token addresses, sends `settle_match` to CRE

#### Data Model (Prisma)

```
Token (address, name, symbol, decimals)
  └── Pair (baseTokenAddress, quoteTokenAddress)
        └── Order (pairId, amount, price, side, status, stealthPublicKey, userAddress)
User (address, name, isVerified, nonce)
  ├── Order[]
  ├── TokenBalance[] (token, balance)
  └── Session[] (JWT sessions)
```

Order lifecycle: `PENDING` -> `OPEN` -> `MATCHED` -> `SETTLED` (or `CANCELLED`)

### Frontend (`frontend/`)

React 19 + Vite + TailwindCSS trading terminal:

- **Terminal** -- Order entry (select pair, buy/sell, price/amount, stealth public key)
- **Portfolio** -- Token balances and positions
- **Compliance** -- World ID verification status
- **History** -- Past trades and settlements
- **FundingModal** -- Deposit tokens into the vault

### Key Properties

- **Sybil-resistant** -- World ID ensures one person = one verified address
- **Private settlement** -- Stealth addresses prevent linking trades to user wallets
- **Confidential order book** -- Orders stored in backend database, never on-chain
- **Dynamic pairs** -- Trading pairs auto-created when new tokens are deposited
- **Trustless settlement** -- Only CRE (via KeystoneForwarder) can trigger vault transfers
- **Two-step orders** -- Create + confirm prevents unauthorized order placement

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

Configure `cre/verify-and-order-workflow/config.staging.json`:

```json
{
  "vaultAddress": "0x...",
  "chainSelectorName": "ethereum-testnet-sepolia-base-1",
  "authorizedEVMAddress": "0x...",
  "gasLimit": "500000",
  "worldIdVerifyUrl": "https://developer.worldcoin.org/api/v2/verify/...",
  "worldIdAction": "verify-human"
}
```

Set your private key in `cre/.env`:

```
CRE_ETH_PRIVATE_KEY=<your-private-key>
CRE_TARGET=staging-settings
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

### Deploy Contracts

```bash
cd contracts
forge script script/Deploy.s.sol:DeploySSL --rpc-url $RPC_URL --broadcast
```

Environment variables:
- `PRIVATE_KEY` -- Deployer private key
- `FORWARDER_ADDRESS` -- KeystoneForwarder address (defaults to mock)

## Tech Stack

- **Solidity** (Foundry) -- Smart contracts (vault, receiver, mocks)
- **Chainlink CRE** -- Off-chain confidential compute (verification, stealth addresses, settlement reports)
- **World ID** (`@worldcoin/idkit`) -- Sybil-resistant identity verification
- **Stealth Addresses** -- ECDH-derived one-time addresses (EIP-5564 style, secp256k1)
- **Bun + Hono** -- Backend HTTP server
- **PostgreSQL + Prisma** -- Order book, user data, token balances, trading pairs
- **ethers.js** -- On-chain event listening (vault deposits, withdrawals)
- **viem** -- ABI encoding, keccak256, signature verification
- **@noble/curves** -- secp256k1 ECDH for stealth address derivation
- **OpenZeppelin** -- SafeERC20, ReentrancyGuard
- **React 19 + Vite + TailwindCSS** -- Frontend trading terminal

## License

MIT
