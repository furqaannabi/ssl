# Privacy Track Qualification & Implementation Research

**Hackathon Track:** Privacy Track (Convergence: A Chainlink Hackathon)
**Goal:** Prove the Stealth Settlement Layer project qualifies by implementing mandatory privacy-preserving features using Chainlink CRE's early-access **Confidential HTTP**.

---

## 1. The Core Problem
The project received feedback stating it "did not implement any privacy solution" and pointed to the [CRE Confidential HTTP capability docs](https://docs.chain.link/cre/capabilities/confidential-http-ts).

While the dark pool concept is fundamentally private, the *execution code* in `cre/matching-workflow/main.ts` relied entirely on the standard `HTTPClient` for both fetching external data and communicating with the backend. In a decentralized network, standard HTTP calls expose the request logic, headers, API keys, and unencrypted responses to node operators.

To qualify for the Privacy Track, the project must explicitly use the `@chainlink/cre-sdk` export `ConfidentialHTTPClient` to demonstrate hardware-level enclave isolation.

---

## 2. Track Requirements & Alignment
The [Privacy Track Prizes Page](https://chain.link/hackathon/prizes) outlines the following requirements and use-cases that Stealth Pool perfectly aligns with:

1. **"OTC and brokered settlements privately"**
   *Our Alignment:* Stealth Pool is a dark pool where order parameters are encrypted client-side and only ever decrypted inside the TEE enclave for matching.
2. **"Secure Web2 API integration for decentralized workflows: use external APIs in CRE without exposing API keys"**
   *Our Alignment:* We require real-time pricing from Finnhub to ensure dark pool matches are fair. We can meet this track requirement by pulling Finnhub prices inside the TEE.
3. **"Response privacy: API responses may contain sensitive fields that should not be visible"**
   *Our Alignment:* When the dark pool match succeeds, it sends token transfer instructions and settlement details back to the backend. We can encrypt this payload using CRE's `EncryptOutput` feature.

---

## 3. The Implementation Blueprint

To fully satisfy the Chainlink judges, we will upgrade `cre/matching-workflow/main.ts` to implement the two core pillars of Confidential HTTP:

### Feature A: Credential Isolation (Inbound Data)
We will use `ConfidentialHTTPClient` to securely fetch the real-time asset price from Finnhub directly inside the TEE enclave *during the matching logic*. 

*   **How it works:** We use Chainlink Vault DON Secrets to inject the `finnhubApiKey` straight into the HTTP request headers inside the enclave. 
*   **Why it matters:** The Finnhub API key is never exposed to node memory, logs, or network traffic.
*   **Business logic impact (Slippage Protection):** If the matched private order price deviates too far from the live Finnhub market price (e.g., > 5% slippage), the match is rejected, proving the external data fetch has a tangible security purpose.

### Feature B: Response Encryption (Outbound Data)
The docs state: *"With Confidential HTTP and EncryptOutput enabled, the full response is encrypted before leaving the enclave—it can only be decrypted using the encryption key, for example in your own backend service."*

*   **How it works:** When the TEE matching workflow finishes the Convergence token transfers, it needs to send the match details (buyer/seller amounts, tx IDs) back to the application backend (`/api/order/cre-settle`). We will route this callback through `ConfidentialHTTPClient` with `encryptOutput: true`.
*   **Why it matters:** Currently, this egress happens in plain text. By enabling `EncryptOutput`, the dark pool's final settlement details are encrypted *before* they exit the enclave, proving end-to-end data protection.

---

## 4. Technical Syntax Discovered in SDK

Based on the latest TypeScript SDK reference (`@chainlink/cre-sdk` v1.1.0), the syntax for the Confidential HTTP capability is:

```typescript
import { ConfidentialHTTPClient, ok, json } from "@chainlink/cre-sdk";

const confHTTPClient = new ConfidentialHTTPClient();

const response = confHTTPClient.sendRequest(runtime, {
    request: {
        url: "https://finnhub.io/api/v1/quote?symbol=AAPL",
        method: "GET",
        multiHeaders: {
            // Template syntax injects secret ONLY inside enclave
            Authorization: { values: ["Basic {{.finnhubApiKey}}"] },
        },
        encryptOutput: false // (or true for egress data)
    },
    vaultDonSecrets: [{ key: "finnhubApiKey", owner: runtime.config.finnhubSecretOwner }],
}).result();

if (!ok(response)) {
    throw new Error(`HTTP request failed with status: ${response.statusCode}`);
}

const data = json(response);
```

Replacing the standard `HTTPClient` with this exact implementation for both the Finnhub price check and the backend settlement callback will definitively prove the Privacy Track requirements have been met.
