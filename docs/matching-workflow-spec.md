SSL Matching Engine - Confidential Compute Implementation
Project Overview
SSL (Stealth Settlement Layer) is a private, sybil-resistant, cross-chain token trading platform. Users can trade tokenized RWAs (stocks, ETFs, bonds) with privacy - order book and matching happen off-chain, settlement via Chainlink CRE.
Hackathon Track
Privacy Track - Using Chainlink CRE + Confidential Compute (TEE) for:
- Private transactions with sealed order book
- Confidential API connectivity (price feeds)
- Protected computation in Trusted Execution Environments
---
Current Architecture
Frontend          Backend              CRE              Vault
    │                 │                  │                │
    ├── Submit Order ─┼─── Save to DB ───┤                │
    │                 │                  ├── Match Orders ┼── Settle
    │                 │                  │                │
    │<── Order Book ──┼<─── Query ───────┤                │
Current State:
- ✅ CRE for settlement (verify, settle, withdraw)
- ✅ Off-chain order book (PostgreSQL)
- ✅ Matching in plain Node.js (not in TEE)
- ✅ Finnhub API for prices (regular HTTP)
- ⚠️ Operators can see matching logic and data
---
Target Architecture
┌─────────────┐     ┌─────────────┐     ┌─────────────────────┐     ┌─────────────┐
│  Frontend   │────▶│   Backend   │────▶│  CRE (TEE Enclave)  │────▶│   Vault    │
│ (encrypt)   │     │ (persist)   │     │  (matching + HTTP)  │     │ (settle)   │
└─────────────┘     └─────────────┘     └─────────────────────┘     └─────────────┘
      │                   │                      │                         │
      │              PostgreSQL              TEE Enclave                On-chain
      │              (orders DB)         (confidential)             (final state)
What's New:
- Matching engine runs inside TEE (invisible to operators)
- Price fetching via Confidential HTTP (API keys protected)
- Client-side order encryption (only TEE can decrypt)
- Attested results provide cryptographic proof
---
What Lives in TEE (Confidential Compute)
| Component | Description |
|-----------|-------------|
| Matching Engine | Price-time priority matching logic |
| Order Storage | In-memory order book (per workflow run) |
| Confidential HTTP | Price fetching from Finnhub (API keys protected) |
| Encryption/Decryption | Decrypt incoming orders, encrypt responses |
---
Implementation Details
1. Order Submission Flow
1. Frontend fetches CRE public key
2. Frontend encrypts order: { pairId, side, amount, price, stealthAddress, signature }
3. Send encrypted payload to backend
4. Backend persists order to PostgreSQL with status "PROCESSING"
5. Backend proxies to CRE matching workflow
6. CRE decrypts inside TEE (only TEE can decrypt)
7. Matching runs in TEE (invisible to everyone)
8. If match found → settlement via existing CRE workflow
9. Result encrypted in TEE → back to frontend
10. Backend updates order status in PostgreSQL
2. Encryption Specification
- Algorithm: ECIES (Elliptic Curve Integrated Encryption Scheme)
- Key Exchange: P-256 ECDH
- Symmetric: AES-256-GCM
- Signature: ECDSA (user signs order before encryption)
3. Authorization
- Users sign order payload with their wallet (Ethereum ECDSA)
- CRE verifies signature inside TEE before processing
- Prevents unauthorized order submission
4. Fallback Mechanism
If CRE matching workflow is unavailable:
1. Backend detects CRE failure
2. Falls back to current Node.js matching engine
3. Frontend shows "Fallback mode" indicator
4. Matching proceeds as before (less private but functional)
5. Order Persistence
PostgreSQL Schema:
CREATE TABLE orders (
  id              UUID PRIMARY KEY,
  pair_id         VARCHAR(64) NOT NULL,
  side            VARCHAR(4) NOT NULL,
  amount          VARCHAR(64) NOT NULL,
  price           VARCHAR(64) NOT NULL,
  stealth_address VARCHAR(42) NOT NULL,
  user_address    VARCHAR(42) NOT NULL,
  base_chain_selector VARCHAR(64),
  quote_chain_selector VARCHAR(64),
  status          VARCHAR(16) DEFAULT 'PROCESSING',
  filled_amount   VARCHAR(64) DEFAULT '0',
  cre_match_id    VARCHAR(64),
  fallback_mode   BOOLEAN DEFAULT FALSE,
  created_at     TIMESTAMP DEFAULT NOW(),
  updated_at     TIMESTAMP DEFAULT NOW()
);
6. Price Feed
- Provider: Finnhub API (https://finnhub.io/api/v1)
- Symbols: META, GOOGL, AAPL, TSLA, AMZN, NVDA, SPY, QQQ, TLT
- Access: API key stored in CRE secrets (Vault DON)
- Confidentiality: API calls made inside TEE - key never exposed
---
Files to Create/Modify
New Files
| File | Purpose |
|------|---------|
| cre/matching-workflow/main.ts | TEE matching workflow - HTTP trigger + matching logic |
| cre/matching-workflow/config.json | Chain configs, price API URLs, vault addresses |
| cre/matching-workflow/package.json | TypeScript dependencies |
| cre/matching-workflow/workflow.yaml | Workflow configuration |
| cre/matching-workflow/tsconfig.json | TypeScript configuration |
| cre/matching-workflow/secrets.yaml | API key references |
| frontend/lib/crypto.ts | Client-side encryption utilities |
| frontend/lib/cre-client.ts | Frontend CRE communication |
| backend/src/lib/cre-client.ts | Backend CRE communication |
Modify Existing Files
| File | Changes |
|------|---------|
| backend/src/routes/order.ts | Proxy encrypted orders to CRE, handle fallback |
| frontend/components/OrderPreviewModal.tsx | Encrypt order before submit |
| cre/verify-and-order-workflow/main.ts | May need updates for new match flow |
---
Matching Engine Specification
Core Logic (Port from Node.js to TypeScript)
interface Order {
  id: string;
  pairId: string;
  side: 'BUY' | 'SELL';
  amount: bigint;    // in wei
  price: bigint;    // price per unit in USDC (6 decimals)
  stealthAddress: string;
  userAddress: string;
  createdAt: number;
}
// Price-Time Priority Matching
// - Orders sorted by price (descending for BUYS, ascending for SELLS)
// - Then by timestamp (FIFO)
// - Partial fills supported
Order Book Structure
type OrderBook = {
  bids: Map<string, Order[]>;  // price -> orders
  asks: Map<string, Order[]>;  // price -> orders
};
Match Algorithm
1. Incoming BUY order → check against ASKS (lowest price first)
2. Incoming SELL order → check against BIDS (highest price first)
3. Price match: buyPrice >= sellPrice
4. Calculate fill amounts (respecting remaining quantities)
5. Update order book, return match result
---
API Specification
Frontend → Backend
// POST /api/order
{
  encrypted: string;        // Base64 encrypted order
  signature: string;        // User's ECDSA signature
  fallbackEnabled: boolean; // Request fallback if CRE fails
}
Backend → CRE
// POST to CRE HTTP endpoint
{
  action: "match_order",
  encryptedOrder: string,   // Encrypted order from frontend
  signature: string,        // Verified signature
  pairId: string,
}
CRE → Backend
// Response
{
  status: "matched" | "pending" | "failed",
  matchId?: string,
  filledAmount?: string,
  error?: string,
  txHash?: string,          // Settlement tx if matched
}
---
Security Properties
| Property | How Achieved |
|----------|--------------|
| Order Privacy | Orders encrypted client-side, only TEE can decrypt |
| Matching Privacy | Matching logic runs in TEE, invisible to operators |
| API Key Protection | Finnhub key stored in Vault DON, accessed only inside TEE |
| Authorization | ECDSA signature verification inside TEE |
| Attestation | CRE provides cryptographic proof of execution |
| Data Minimization | TEE only receives order data needed for matching |
---
Testing Plan
1. Unit Tests: Matching engine logic (price-time priority, partial fills)
2. Integration Tests: Backend ↔ CRE communication
3. E2E Tests: Full flow from frontend encryption to settlement
4. Fallback Tests: Verify fallback mechanism works when CRE unavailable
---
Timeline Estimate
| Phase | Task | Effort |
|-------|------|--------|
| 1 | CRE matching workflow setup | 2 hrs |
| 2 | Port matching logic to TypeScript | 3 hrs |
| 3 | Add HTTP trigger + authorization | 2 hrs |
| 4 | Add Confidential HTTP for prices | 2 hrs |
| 5 | Backend CRE client + proxy | 2 hrs |
| 6 | Frontend encryption utilities | 3 hrs |
| 7 | Frontend integration | 2 hrs |
| 8 | Fallback mechanism | 1 hr |
| 9 | Testing + debugging | 4 hrs |
| Total | | ~19 hours |
---
Dependencies
- CRE SDK: @chainlink/cre-sdk (TypeScript)
- Frontend: React, Web Crypto API (native)
- Backend: Bun, Hono, Prisma
- Database: PostgreSQL (existing)
- Price Feed: Finnhub API (existing)
- CRE Early Access: Confirmed ✓
---
References
- Chainlink CRE Documentation: https://docs.chain.link/cre
- Confidential Compute Whitepaper: https://research.chain.link/confidential-compute.pdf
- Current CRE workflow: cre/verify-and-order-workflow/main.ts
- Current matching engine: backend/src/lib/matching-engine.ts
---
Questions for Team
1. Is the encryption approach (ECIES + ECDSA) acceptable?
2. Should we use deterministic order IDs for idempotency?
3. Any specific price feed requirements beyond Finnhub?
4. Preferred approach for order cancellation (in TEE)?
---
