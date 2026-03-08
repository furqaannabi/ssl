# SSL — Stealth Settlement Layer

*Built with ❤️ by Furqaan Nabi and Chukwunonso Ikeji for the Chainlink Convergence Hackathon.*
[![Network](https://img.shields.io/badge/Network-Ethereum_Sepolia-lightgrey.svg)]()
[![Built with Chainlink](https://img.shields.io/badge/Chainlink-CRE_%7C_ACE_%7C_Confidential_HTTP-blue.svg)](https://chain.link)
[![World ID Validated](https://img.shields.io/badge/Identity-World_ID-black.svg)](https://worldcoin.org/world-id)
[![Privacy Track](https://img.shields.io/badge/Track-Privacy_(Confidential_HTTP)-purple.svg)]()

**Stealth Settlement Layer (SSL)** is a privacy-preserving, sybil-resistant trading platform for tokenized Real World Assets (RWAs).

Public blockchains natively expose trading activity, leaving institutional traders and whales vulnerable to front-running, copy-trading, and strategy leakage. SSL mitigates these risks by providing a "dark pool" trading experience: identities are verified for compliance, but order matching and settlement remain completely confidential through the use of **Trusted Execution Environments (TEEs)** and **Shield Addresses**.

## Core Value Proposition

1. **Confidential Order Matching:** Orders are client-side encrypted (ECIES). The order book is matched entirely inside a **Chainlink CRE (Confidential Routing Engine) TEE**. Order details (price, size, direction) are mathematically proven to be invisible to the public, the blockchain, and even the platform operator.
2. **Privacy-Preserving External Data (Confidential HTTP):** Real-time asset prices are fetched from Finnhub **inside the TEE enclave** using `ConfidentialHTTPClient` with Vault DON secret injection — API credentials never leave the enclave. A 5% slippage guard rejects trades that deviate from the live market price. Settlement callbacks use `encryptOutput: true` so trade details are AES-GCM encrypted before exiting the enclave.
3. **Sybil-Resistant Compliance via ACE:** Leveraging **World ID** and **Chainlink ACE** (Automated Compliance Engine), SSL enforces strict on-chain compliance. Unverified entities are blocked from depositing into the settlement vault by on-chain policies.
4. **Private Settlement:** Upon matching, matched tokens are transferred to single-use **Shield Addresses** generated exclusively for that trade. The on-chain footprint guarantees liquidity without directly linking the settlement destination back to the trader's primary wallet.
5. **AI-Powered Trading Interface:** Features a natural language AI chatbot (powered by Google Gemini) acting as a trading terminal assistant. It parses complex context-aware trading orders and provides "Stealth Intelligence"—a real-time trend confidence indicator based on anonymized settlement data.

---

## System Architecture

### 1. Identity Verification (World ID + ACE)
Before any trading can occur, users must prove they are unique humans to prevent sybil attacks and enforce compliance.
- The user completes a **World ID** verification flow in the browser.
- The resulting Zero-Knowledge (ZK) proof is sent to the backend.
- The backend triggers the `verify-workflow` inside a **Chainlink CRE TEE**.
- The TEE validates the proof. If valid, it submits an on-chain report to the Ethereum Sepolia `WorldIDVerifierRegistry` contract, marking the user's EOA address as `isVerified = true`.
- An **ACE (Arbitrary Compute Environment)** policy contract guards the Convergence Vault. It queries the registry and only allows `deposit()` transactions from verified addresses.

### 2. Confidential Order Matching (The Dark Pool)
Orders are matched without revealing the trader's intent to the public or the platform operator.
- The user generates a single-use **Shield Address** (stealth address) for settlement.
- The order details (pair, size, price, side, shield address) are encrypted in the browser using ECIES with the CRE TEE's public key.
- The frontend submits the encrypted order blob to the backend, which stores it as `PENDING`.
- The backend triggers the `matching-workflow` inside the **CRE TEE**, passing the new encrypted order.
- The TEE decrypts the new order, securely fetches the encrypted resting order book via HTTP, and decrypts it in memory.
- The TEE executes a price-time priority matching engine entirely within the enclave.
- **Privacy Track Feature A (Credential Isolation):** During matching, the TEE securely fetches the live market price from the **Finnhub API** via `ConfidentialHTTPClient`. The API key is injected directly into the enclave using `runtime.getSecret()` (compatible with Vault DON Secrets), never exposing it to the node operator. If the match deviates by more than 5% from the live price, the slippage guard aborts the trade.
- Finally, the TEE checks the `WorldIDVerifierRegistry` on-chain to ensure both the buyer and seller EOAs are still verified.

### 3. Private Settlement (Convergence + Encrypted Callbacks)
Once matched, assets are exchanged without linking them back to the traders' main wallets.
- Inside the TEE, the workflow signs EIP-712 payloads authorizing Convergence private transfers: the Base token (e.g., tAAPL) goes to the buyer's Shield Address, and the Quote token (USDC) goes to the seller's Shield Address.
- **Privacy Track Feature B (Response Encryption):** After successful on-chain transfers, the TEE must notify the backend to update the database. It calls the backend via `ConfidentialHTTPClient` with `encryptOutput: true`. The settlement details (trade amounts, transaction IDs) are AES-GCM encrypted *before* leaving the enclave. The backend decrypts this payload and marks the orders as `SETTLED`.

### CRE Workflow Responses

#### `verify-workflow` — World ID Verification Result
```json
{
  "status": "verified",
  "nullifier_hash": "0x2a7c...b3f1",
  "userAddress": "0xdc468db7a8ab8da86cf0bb099afd15bb9bfea0bb",
  "chains": {
    "ethereum-testnet-sepolia": "0xabc123...txhash",
    "arbitrum-sepolia": "already_verified"
  }
}
```
On success, the TEE validates the World ID ZK proof, encodes an on-chain report (`reportType=0, user=address`), and submits it to the `WorldIDVerifierRegistry` on each target chain. If a user is already verified on a chain, that chain is skipped. On failure, returns `{ "status": "failed", "error": "...", "worldErrorCode": "..." }`.

#### `matching-workflow` — Confidential Order Matching Result
```json
{
  "status": "matched",
  "buyerOrderId": "3131ea1d-9012-4b72-80e5-a1e407fcda90",
  "sellerOrderId": "798d2025-ada9-430d-9df9-1abbf5a9a4db",
  "tradeAmount": "0.001",
  "quoteAmount": "0.000500",
  "buyerTxId": "019cc251-4863-7a0f-9fbc-5a60a11bfd1e",
  "sellerTxId": "019cc251-4aca-72fc-91ff-6011fe64e6ce"
}
```
The TEE decrypts orders, matches them privately, verifies both parties on-chain, fetches the live Finnhub price via `ConfidentialHTTPClient`, executes Convergence private transfers to Shield Addresses, and sends an encrypted settlement callback to the backend. If no match is found, returns `{ "status": "pending", "orderId": "..." }`. If slippage exceeds 5%, returns `{ "status": "pending", "reason": "price_check_failed" }`.

---

## AI System Workflows (Powered by Gemini)

SSL includes an embedded AI chatbot powered by Google Gemini, providing three distinct capabilities:

### 1. Natural Language Order Parsing
The AI acts as a trading assistant, understanding complex context-aware commands.
- A user types: *"buy 10 of the tNVDA we discussed at market price"*.
- The backend's NLP service sends the message and the last 10 chat messages to Gemini.
- Gemini extracts the intent, resolving ambiguities based on chat history.
- If valid, the UI opens a pre-filled Order Preview Modal. The user reviews the details, signs via MetaMask, and the encrypted order is submitted to the CRE TEE.

### 2. Stealth Intelligence Oracle
A unique feature that leverages dark pool data to provide market sentiment without revealing individual trades.
- As orders settle privately, the backend aggregates the data to calculate a Volume-Weighted Average Price (VWAP) for each pair.
- The oracle compares the current live price against the hidden VWAP.
- If the volume threshold is met (≥ 2 settlements), it emits a "BULLISH" or "BEARISH" signal with a confidence percentage to the frontend UI.
- This provides traders with insight into dark pool sentiment while preserving total individual privacy.

### 3. AI Advisor Context Pipeline
The chatbot provides personalized, portfolio-aware advice without compromising privacy.
- Users can "Sync Portfolio" by signing an EIP-712 message.
- The frontend fetches live balances securely from the Convergence Vault.
- These balances are stored **only in React state** (browser memory) and are never saved to the backend database.
- Every chat request to the AI includes these ephemeral balances in the payload.
- Gemini uses this context to provide tailored advice (e.g., *"Your portfolio is heavily weighted in equities, consider diversifying"*), streaming the response back via SSE.

---

## Project Structure

| Directory | Description |
|-----------|-------------|
| **`/frontend`** | React 19 + Vite app. Features the trading terminal, World ID verification widget, and the Gemini-powered AI order parsing chatbot. |
| **`/backend`** | Bun + Hono API. Manages the encrypted order book database, AI context services, realtime Oracle aggregation, and bridging to the CRE TEEs. |
| **`/cre/matching-workflow`** | The Chainlink CRE enclave logic that decrypts the order book and executes trades unseen. |
| **`/cre/verify-workflow`** | The Chainlink CRE enclave logic that validates World ID zero-knowledge proofs and pushes results to the on-chain registry. |
| **`/Compliant-Private-Transfer-Demo`** | Foundry project containing all Solidity smart contracts (`WorldIDVerifierRegistry`, `WorldIDPolicy`, etc.) and deployment scripts. |

---

## Key Addresses (Ethereum Sepolia)

| Contract | Address |
|---|---|
| Convergence Vault | `0xE588a6c73933BFD66Af9b4A07d48bcE59c0D2d13` |
| CRE Forwarder | `0x15fC6ae953E024d975e77382eEeC56A9101f9F88` |
| USDC Token | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| WorldIDVerifierRegistry | `0xb1eA4506e10e4Be8159ABcC7A7a67C614a13A425` |

### Supported RWA Tokens

- **Equities:** `tMETA`, `tGOOGL`, `tAAPL`, `tTSLA`, `tAMZN`, `tNVDA`
- **ETFs / Indices:** `tSPY`, `tQQQ`
- **Fixed Income:** `tBOND`

---

## Local Development Setup

### Prerequisites
- [Bun](https://bun.sh/) v1.2+
- [Foundry](https://book.getfoundry.sh/) (for contract development)
- [CRE CLI](https://docs.chain.link/cre) (for enclave simulation)
- PostgreSQL (for the backend order book)

### 1. Smart Contracts
If deploying customized compliance policies:
```bash
cd Compliant-Private-Transfer-Demo
forge install
forge build --via-ir

export PRIVATE_KEY=<your_sepolia_private_key>
export RPC_URL=<sepolia_rpc_url>

# Register SSL tokens to Convergence Vault
forge script script/RegisterAllSSLTokens.s.sol --rpc-url $RPC_URL --broadcast --private-key $PRIVATE_KEY

# Deploy World ID Compliance Layer
forge script script/03_DeployWorldIDPolicy.s.sol --rpc-url $RPC_URL --broadcast --private-key $PRIVATE_KEY
```
*Note: Ensure the resulting `WorldIDVerifierRegistry` address is updated in your backend `.env` and CRE workflow configs.*

### 2. Backend Server
```bash
cd backend
cp .env.example .env   # Configure DATABASE_URL, OPENAI_API_KEY (for Gemini), EVM_PRIVATE_KEY
bun install
bun run db:push
bun run dev
```

### 3. Chainlink CRE Simulation
To simulate the TEE workflows locally:
```bash
cd cre/matching-workflow && bun install
cre workflow simulate matching-workflow --target=staging-settings

cd ../verify-workflow && bun install
cre workflow simulate verify-workflow --target=staging-settings
```
*(Note: Ensure your `cre/.env` contains `FINNHUB_API_KEY` and `CRE_CALLBACK_SECRET` before simulating the matching workflow).*

### 4. Frontend Terminal
```bash
cd frontend
bun install
bun run dev
```

---

## 🛠️ Tech Stack

- **Smart Contracts:** Solidity, Foundry, Chainlink ACE (Arbitrary Compute Environment)
- **Confidential Computing:** Chainlink CRE (Confidential Routing Engine), Confidential HTTP (`ConfidentialHTTPClient`)
- **Privacy Features:** Vault DON Secret Injection, AES-GCM Response Encryption (`encryptOutput`), Slippage Protection
- **Identity:** World ID (Zero-Knowledge Proofs)
- **Backend:** Bun, Hono, PostgreSQL, Prisma, Viem
- **Frontend:** React 19, Vite, TailwindCSS (Dark-mode optimized)
- **AI & Data:** Google Gemini (via OpenAI SDK), Finnhub API (real-time RWA price feeds via Confidential HTTP)

## 🚀 Upcoming Milestones

1. **Cross-Chain Settlement via CCIP:** Seamless cross-chain liquidity. For example, a user pays USDC on Ethereum and receives tMETA on Arbitrum.
2. **KYC & Institutional Compliance:** Enhancing our World ID integration to support strict, configurable KYC checks for onboarding institutional liquidity while preserving dark pool privacy using ACE.
3. **Mainnet Launch:** Deploying the full CRE TEE enclave and Convergence Vault infrastructure to Ethereum Mainnet.

---

## License
MIT
