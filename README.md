# SSL - Stealth Settlement Layer

Private, sybil-resistant token settlement using **World ID**, **stealth addresses**, and **Chainlink CRE**.

## How It Works

```
User ──> Backend ──> CRE (Chainlink) ──> Vault (on-chain)
```

1. **Verify** - User submits World ID proof to backend. Backend forwards to CRE. CRE verifies and writes a report to the vault, marking the user's nullifier as verified.
2. **Fund** - User deposits tokens into the vault. The vault checks the nullifier is CRE-verified before accepting.
3. **Order** - User submits a trade order (BUY/SELL) via backend to CRE. CRE stores it in a confidential order book.
4. **Match** - CRE matches compatible buy/sell orders off-chain. No order details are visible on-chain.
5. **Settle** - CRE generates one-time stealth addresses for both parties, then writes a settlement report to the vault. Tokens are transferred to the stealth addresses.

No user wallet is exposed during settlement. Only the CRE (via KeystoneForwarder) can write to the vault.

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
- **Stealth Addresses** - One-time addresses derived from `keccak256(stealthPubKey || tradeNonce)`
- **OpenZeppelin** - SafeERC20, ReentrancyGuard, Ownable

## License

MIT
