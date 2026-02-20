# SSL Frontend — Trading Terminal

React + Vite frontend for the Stealth Settlement Layer. A dark-themed trading terminal with World ID verification, stealth address generation, multi-chain order management, and an AI financial advisor chatbot.

## Features

- **Wallet Connection** -- RainbowKit (MetaMask, Coinbase Wallet, WalletConnect)
- **SIWE Authentication** -- Sign-In with Ethereum session management
- **World ID Verification** -- Sybil-resistant identity proof
- **Stealth Address Generation** -- Client-side one-time addresses for private settlement
- **Order Entry** -- Limit orders with BUY/SELL on any whitelisted RWA pair
- **Order Book** -- Real-time obfuscated order book with bid/ask depth
- **Portfolio** -- Per-chain token balances across Base Sepolia and Arbitrum Sepolia
- **Deposit (Funding)** -- Deposit whitelisted RWA tokens with type badges (STOCK/ETF/BOND/STABLE)
- **Withdrawal** -- Request withdrawal of deposited tokens
- **AI Financial Advisor** -- Floating chatbot (bottom-right) powered by GPT-4o:
  - Portfolio analysis with real-time prices
  - Arbitrage opportunity detection and alerts
  - Market overview for all whitelisted tokens
  - Quick prompt buttons for common queries
  - SSE streaming responses
- **Compliance Dashboard** -- Verification stats and audit log
- **Transaction History** -- Unified order + on-chain transaction history

## Whitelisted RWA Tokens

The platform only allows trading of pre-approved tokenized Real World Assets:

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

## Setup

**Prerequisites:** Bun (v1.2+)

```bash
bun install
bun run dev
```

The app runs at `http://localhost:5173`.

## Environment

Create a `.env` or configure via Vite env:

| Variable | Description | Default |
|---|---|---|
| `VITE_API_URL` | Backend API base URL | `https://arc.furqaannabi.com` |

## Project Structure

```
frontend/
├── App.tsx                        # Main app with routing, auth, wallet, AI chatbot
├── components/
│   ├── AIChatbot.tsx              # AI financial advisor chatbot (floating panel)
│   ├── Terminal.tsx               # Trading interface with order book
│   ├── Portfolio.tsx              # Per-chain token balances
│   ├── FundingModal.tsx           # Token deposit with RWA type badges
│   ├── WithdrawalModal.tsx        # Withdrawal request UI
│   ├── WorldIdKit.tsx             # World ID verification
│   ├── OracleIndicator.tsx        # Market signal indicator
│   ├── Compliance.tsx             # Compliance dashboard
│   ├── History.tsx                # Transaction history
│   ├── ProfileModal.tsx           # User profile + stealth keys
│   ├── SettingsModal.tsx          # App settings
│   ├── StealthKeyReveal.tsx       # Stealth key management
│   └── UI.tsx                     # Shared components (Icon, Button, Modal, Card, Badge, Toast)
├── lib/
│   ├── contracts.ts               # Token addresses, decimals, RWA_TOKENS metadata, ABI fragments
│   ├── chain-config.ts            # Multi-chain config (Base Sepolia, Arbitrum Sepolia)
│   ├── wagmi.ts                   # Wagmi config
│   ├── auth.ts                    # SIWE authentication
│   └── abi/                       # Contract ABIs
└── index.html
```

## Tech Stack

- React 19 + Vite 6
- TailwindCSS 3
- Wagmi 3 + RainbowKit 2
- viem 2
- @worldcoin/idkit 2
- recharts 3
- lucide-react (icons)
