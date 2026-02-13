# SSL - Stealth Settlement Layer

Private, sybil-resistant token settlement using **World ID**, **stealth addresses**, and **Chainlink CRE**.

## How It Works

```
User ──> Backend ──> CRE (Chainlink) ──> Vault (on-chain)
```

### Phase 1: Identity Verification

```
User                    Backend                 CRE                     Vault
 │                        │                      │                       │
 │── World ID proof ────> │                      │                       │
 │                        │── HTTP {action:       │                       │
 │                        │   "verify",           │                       │
 │                        │   nullifierHash} ───> │                       │
 │                        │   (signed with        │                       │
 │                        │    authorized key)     │                       │
 │                        │                       │── report(type=0) ──> │
 │                        │                       │   encodeAbiParameters │
 │                        │                       │   (uint8=0,          │
 │                        │                       │    nullifierHash)     │
 │                        │                       │                      │── isVerified[
 │                        │                       │                      │   nullifierHash
 │                        │                       │                      │   ] = true
 │                        │                       │                      │── emit Verified
 │                        │ <── {status:verified} │                       │
 │ <── verified ────────  │                       │                       │
```

- Backend signs HTTP request with its EVM key (must be in CRE `authorizedKeys`)
- CRE receives via `HTTPCapability`, verifies backend signature
- CRE encodes `(uint8 reportType=0, uint256 nullifierHash)`
- `runtime.report()` signs the payload -> `evmClient.writeReport()` sends to KeystoneForwarder
- Forwarder calls `vault.onReport()` -> `_processReport()` -> `_processVerify()`
- Vault marks `isVerified[nullifierHash] = true`

### Phase 2: Funding

```
User                                            Vault
 │                                                │
 │── approve(vault, amount) ───────────────────> │
 │── fund(token, amount, nullifierHash) ───────> │
 │                                                │── require(isVerified[nullifierHash])
 │                                                │── safeTransferFrom(user, vault, amount)
 │                                                │── emit Funded(token, amount, nullifierHash)
```

- User calls vault directly with their wallet
- Vault checks the nullifier was already verified by CRE (Phase 1)
- Tokens are transferred into the vault
- No World ID proof needed here — verification already happened via CRE report

### Phase 3: Order Submission

```
User                    Backend                 CRE
 │                        │                      │
 │── order {              │                      │
 │    asset, quoteToken,  │                      │
 │    amount, price,      │                      │
 │    side, nullifier,    │                      │
 │    stealthPublicKey    │                      │
 │   } ────────────────>  │                      │
 │                        │── HTTP {action:       │
 │                        │   "order", ...} ───> │
 │                        │                      │── storeOrder(order)
 │                        │                      │   buyOrders[] or
 │                        │                      │   sellOrders[]
 │                        │ <── {status:queued}   │
 │ <── queued ──────────  │                       │
```

- User sends order details to backend (never on-chain)
- Backend forwards to CRE as signed HTTP payload
- CRE stores in in-memory order book (confidential, off-chain)
- Order details (asset, price, amount, side) are never visible on-chain

### Phase 4: Matching + Settlement

```
CRE (on match found)                            Vault
 │                                                │
 │── matchOrders()                                │
 │   buy.price >= sell.price                      │
 │   buy.asset == sell.asset                      │
 │                                                │
 │── tradeNonce = keccak256(                      │
 │     buyNullifier + sellNullifier + timestamp)  │
 │                                                │
 │── ECDH stealth (per party):                    │
 │     r = keccak256(tradeNonce + "_buyer")        │
 │     R = r * G  (ephemeral public key)           │
 │     shared = r * S  (ECDH with spending pubkey) │
 │     stealthPub = S + keccak256(shared) * G      │
 │     stealthAddr = address(stealthPub)           │
 │                                                │
 │── orderId = keccak256(                         │
 │     tradeNonce + stealthBuyer + stealthSeller) │
 │                                                │
 │── report(type=1) ───────────────────────────> │
 │   encodeAbiParameters(                         │
 │     uint8=1, orderId,                          │
 │     stealthBuyer, stealthSeller,               │── require(!settledOrders[orderId])
 │     tokenA, tokenB,                            │── safeTransfer(tokenA -> stealthSeller)
 │     amountA, amountB)                          │── safeTransfer(tokenB -> stealthBuyer)
 │                                                │── settledOrders[orderId] = true
 │                                                │── emit Settled(orderId, stealthBuyer,
 │                                                │                stealthSeller)
```

- CRE matches buy order where `price >= sell.price` and same asset
- Generates unique `tradeNonce` from both nullifiers + timestamp
- Derives one-time **stealth addresses** via ECDH (EIP-5564 style) — user can derive the private key to claim funds
- Computes `orderId` to prevent replay
- Encodes settlement as `(uint8 reportType=1, bytes32 orderId, address stealthBuyer, address stealthSeller, address tokenA, address tokenB, uint256 amountA, uint256 amountB)`
- Sends report via KeystoneForwarder -> `_processSettle()`
- Vault transfers `tokenA` to stealth seller, `tokenB` to stealth buyer
- Neither party's real wallet appears in the settlement transaction

### What's On-Chain vs Off-Chain

| Data | Location | Visible? |
|---|---|---|
| Nullifier verified status | On-chain (vault) | Yes |
| Token deposits | On-chain (vault) | Yes |
| Order book (prices, amounts, sides) | CRE (off-chain) | No |
| Match logic | CRE (off-chain) | No |
| Stealth address derivation | CRE (off-chain) | No |
| Settlement transfers | On-chain (vault) | Stealth addresses only |
| Link between user wallet and stealth address | Nowhere | No |

## Architecture

| Component | Description |
|---|---|
| **contracts/** | Solidity - `StealthSettlementVault`, `ReceiverTemplate`, interfaces, mocks |
| **cre/** | Chainlink CRE workflow - HTTP trigger, order matching, stealth address generation, on-chain write |
| **frontend/** | Web UI |

### Contracts

- **StealthSettlementVault** - Holds deposited tokens. Accepts two report types from CRE via `KeystoneForwarder`:
  - `type 0` (verify) - Marks a World ID nullifier as verified
  - `type 1` (settle) - Transfers tokens to stealth addresses
- **ReceiverTemplate** - Abstract base that validates reports come from the trusted forwarder
- **IWorldID** - Interface for World ID on-chain verifier

### CRE Workflow

Single HTTP trigger with two actions:

- `verify` - Receives World ID nullifier, writes verify report to vault
- `order` - Receives trade order, stores in pool, attempts match. On match: generates stealth addresses, writes settlement report to vault

### Key Properties

- **Sybil-resistant** - World ID ensures one person = one identity
- **Private settlement** - Stealth addresses prevent linking trades to user wallets
- **Confidential matching** - Order book lives in CRE, never on-chain
- **Trustless execution** - Only CRE (via KeystoneForwarder) can trigger vault operations

## Setup

### Contracts

```bash
cd contracts
forge install
forge build
forge test -vv
```

### CRE Workflow

```bash
cd cre/ssl
npm install
```

### Deploy

```bash
cd contracts
forge script script/Deploy.s.sol:DeploySSL --rpc-url $RPC_URL --broadcast
```

Environment variables:
- `PRIVATE_KEY` - Deployer private key
- `FORWARDER_ADDRESS` - KeystoneForwarder address (defaults to mock)

## Tech Stack

- **Solidity** (Foundry) - Smart contracts
- **Chainlink CRE** - Off-chain confidential runtime
- **World ID** - Sybil-resistant identity verification
- **Stealth Addresses** - ECDH-derived one-time addresses (EIP-5564 style, secp256k1). See [STEALTH.md](STEALTH.md)
- **OpenZeppelin** - SafeERC20, ReentrancyGuard, Ownable

## License

MIT
