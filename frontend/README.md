# SSL Frontend — Trading Terminal

React + Vite frontend for the Stealth Settlement Layer. A dark-themed trading terminal with World ID verification, shield address generation, order management on **Ethereum Sepolia**, and an AI financial advisor chatbot.

## Features

- **Wallet Connection** -- RainbowKit (MetaMask, Coinbase Wallet, WalletConnect)
- **SIWE Authentication** -- Sign-In with Ethereum session management
- **World ID Verification** -- Sybil-resistant identity proof (required before depositing or trading; enforced by ACE `WorldIDPolicy` on-chain)
- **Shield Address Generation** -- Client-side one-time addresses for private settlement; settlement transfers go to this address so the on-chain record never reveals the real trader
- **Order Entry** -- Limit orders with BUY/SELL on any whitelisted RWA pair (World ID verified users only)
- **Order Book** -- Real-time obfuscated order book with bid/ask depth
- **Portfolio** -- Token balances from the Convergence vault on Ethereum Sepolia
- **Deposit (Funding)** -- Deposit any of the 10 whitelisted tokens (9 RWA + USDC) into the Convergence vault; skips `approve` if allowance is already sufficient, otherwise does `approve` → `deposit` (2 tx)
- **Withdrawal** -- Request withdrawal of deposited tokens (World ID verified users only)
- **AI Financial Advisor** -- Floating chatbot (bottom-right) powered by Gemini 2.5 Flash:
  - Portfolio analysis with real-time prices
  - Arbitrage opportunity detection and alerts
  - Market overview for all whitelisted tokens
  - Quick prompt buttons for common queries
  - SSE streaming responses
- **Compliance Dashboard** -- Verification stats and audit log
- **Transaction History** -- Unified order + on-chain transaction history

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

## Setup

**Prerequisites:** Bun (v1.2+)

```bash
bun install
bun run dev
```

The app runs at `http://localhost:5173`.

## Environment

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
│   ├── Portfolio.tsx              # Token balances from Convergence vault
│   ├── FundingModal.tsx           # Token deposit (calls Convergence API)
│   ├── WithdrawalModal.tsx        # Withdrawal request UI
│   ├── WorldIdKit.tsx             # World ID verification
│   ├── OracleIndicator.tsx        # Market signal indicator
│   ├── Compliance.tsx             # Compliance dashboard
│   ├── History.tsx                # Transaction history
│   ├── ProfileModal.tsx           # User profile + shielded address generation
│   ├── SettingsModal.tsx          # App settings
│   ├── StealthKeyReveal.tsx       # Stealth key management
│   └── UI.tsx                     # Shared components (Icon, Button, Modal, Card, Badge, Toast)
├── lib/
│   ├── contracts.ts               # ETH_SEPOLIA_TOKENS (hardcoded fallback), RWA_TOKENS metadata, ABI fragments
│   ├── chain-config.ts            # Chain config (Ethereum Sepolia)
│   ├── wagmi.ts                   # Wagmi config
│   ├── auth.ts                    # SIWE authentication
│   └── abi/
│       └── convergence_vault_abi.ts  # Convergence vault ABI (deposit, depositWithPermit, register, …)
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
