# Compliant Private Transfer — SSL Integration

> Educational example. Not audited. Do not use in production without your own security review.

This sub-project wires the [Chainlink ACE (Automated Compliance Engine)](https://chain.link/automated-compliance-engine) onto the [Convergence private token vault](https://convergence2026-token-api.cldev.cloud/) on **Ethereum Sepolia**.

It adds two on-chain compliance layers on top of the shared Convergence vault:

1. **Token registration** — every SSL RWA token (tMETA, tGOOGL, tAAPL, tTSLA, tAMZN, tNVDA, tSPY, tQQQ, tBOND) and USDC get their own `PolicyEngine` proxy registered in the vault.
2. **World ID policy** — a `WorldIDPolicy` ACE rule blocks `deposit()` calls from addresses that have not completed World ID "proof-of-humanity" verification. The on-chain `WorldIDVerifierRegistry` is updated by the Chainlink CRE TEE after each successful World ID proof.

---

## Architecture

```
User verified with World ID
        │
        ▼
CRE verify-and-order-workflow (TEE)
        │  verifies proof with World ID cloud API
        │  sends onReport(type=0, userAddress)
        ▼
WorldIDVerifierRegistry.onReport()        ← forwarder-gated
        │  sets isVerified[user] = true
        ▼
User calls deposit(token, amount)
on Convergence vault (0xE588a6c7...)
        │
        ▼
PolicyEngine.run() → WorldIDPolicy.run(caller)
        │  registry.isVerified(caller)?
        │  YES → Allowed   ✓
        │  NO  → PolicyRejected("World ID verification required")
```

### Contracts

| Contract | Description |
|---|---|
| `WorldIDVerifierRegistry` | Ownable registry: `isVerified[address]`. Updated by CRE TEE via `onReport()`. |
| `WorldIDPolicy` | ACE `Policy` that blocks deposit from unverified callers. One proxy per token's PolicyEngine. |

### Scripts

| Script | Purpose |
|---|---|
| `RegisterAllSSLTokens.s.sol` | Registers all 9 RWA tokens + USDC in the Convergence vault; deploys one PolicyEngine impl + proxy per token. |
| `03_DeployWorldIDPolicy.s.sol` | Deploys `WorldIDVerifierRegistry` + `WorldIDPolicy`; wires the policy to every token's PolicyEngine for the `deposit()` selector. |

---

## Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- A wallet with Sepolia ETH

```bash
# From this directory
forge install
forge build --via-ir

export PRIVATE_KEY=<0xyour_private_key>
export RPC_URL=<eth_sepolia_rpc_url>
```

---

## Deployment

### Step 1 — Register SSL tokens in the Convergence vault

Run once. Already-registered tokens are skipped automatically.

```bash
forge script script/RegisterAllSSLTokens.s.sol \
  --rpc-url $RPC_URL \
  --broadcast \
  --private-key $PRIVATE_KEY
```

This deploys one shared `PolicyEngine` implementation and one `ERC1967Proxy` per token, then calls `vault.register(token, policyEngineProxy)` for each.

### Step 2 — Deploy the World ID compliance layer

```bash
forge script script/03_DeployWorldIDPolicy.s.sol \
  --rpc-url $RPC_URL \
  --broadcast \
  --private-key $PRIVATE_KEY
```

Output:
```
WorldIDVerifierRegistry: 0x...   ← copy this address
WorldIDPolicy impl      : 0x...
Wired : tMETA  PolicyEngine: 0x...  PolicyProxy: 0x...
Wired : tGOOGL ...
...
```

### Step 3 — Configure the CRE workflow

Fill in the registry address in `cre/verify-workflow/config.staging.json`:

```json
"ethSepolia": {
  ...
  "worldIdRegistry": "0x<WorldIDVerifierRegistry address>"
}
```

Redeploy the CRE workflow. From now on, every successful World ID verification causes the TEE to call `onReport()` on the registry, marking the user's address as verified on-chain.

---

## How the policy works

`WorldIDPolicy.run(caller, ...)` is called by the PolicyEngine on every `deposit(token, amount)`:

```solidity
function run(address caller, ...) public view override returns (PolicyResult) {
    if (!registry.isVerified(caller)) {
        revert PolicyRejected("World ID verification required to deposit");
    }
    return PolicyResult.Allowed;
}
```

- **Unverified user** → `deposit()` reverts on-chain before any tokens move.
- **Verified user** → `deposit()` proceeds normally into the private vault.

---

## Key Addresses (Ethereum Sepolia)

| Contract | Address |
|---|---|
| Convergence Vault | `0xE588a6c73933BFD66Af9b4A07d48bcE59c0D2d13` |
| CRE Forwarder | `0x15fC6ae953E024d975e77382eEeC56A9101f9F88` |
| WorldIDVerifierRegistry | Printed at deploy time |

---

## References

- [Convergence API Docs](https://convergence2026-token-api.cldev.cloud/docs)
- [Chainlink ACE Overview](https://blog.chain.link/automated-compliance-engine-technical-overview/)
- [Chainlink ACE GitHub](https://github.com/smartcontractkit/chainlink-ace)
- [World ID Developer Docs](https://docs.worldcoin.org/)
