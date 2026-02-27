# SSL Verify Workflow — CRE TEE

Chainlink CRE workflow for World ID proof verification. Runs inside a Trusted Execution Environment (TEE) where the proof is verified against the World ID cloud API and the result is committed on-chain via a signed report.

## What It Does

1. **Receives** a World ID proof payload from the backend (`POST` HTTP trigger).
2. **Verifies** the proof against the World ID Developer API using Confidential HTTP (all nodes must agree on the response via `consensusIdenticalAggregation`).
3. **Checks** if the user is already marked as verified on-chain (`WorldIDVerifierRegistry.isVerified()`). Skips the report if already set.
4. **Sends** a signed on-chain report `(uint8 reportType=0, address user)` to the `WorldIDVerifierRegistry` via `EVMClient.writeReport`, which calls `onReport()` on the registry and sets `isVerified[user] = true`.

## HTTP Trigger Payload

```json
{
  "action": "verify",
  "nullifier_hash": "0x...",
  "proof": "0x...",
  "merkle_root": "0x...",
  "verification_level": "orb",
  "userAddress": "0x123...",
  "selectedChains": ["ethSepolia"]
}
```

`selectedChains` is optional — if omitted, the report is sent to every chain in config.

## Response

```json
{
  "status": "verified",
  "nullifier_hash": "0x...",
  "userAddress": "0x123...",
  "chains": {
    "ethSepolia": "0x<txHash>"
  }
}
```

On failure: `{ "status": "failed", "error": "...", "worldErrorCode": "..." }`

Already-verified users (World ID reports `max_verifications_reached` or `already_verified`) are treated as verified and the on-chain report is still sent.

## Report Encoding

```
ABI-encoded: (uint8 reportType, address user)
  reportType = 0  →  "verify" (sets isVerified[user] = true)
```

## Configuration (`config.staging.json`)

```json
{
  "authorizedEVMAddress": "0x<backend-signer-address>",
  "gasLimit": "300000",
  "worldIdVerifyUrl": "https://developer.worldcoin.org/api/v2/verify/<app_id>",
  "worldIdAction": "sslflow",
  "primaryChain": "ethSepolia",
  "chains": {
    "ethSepolia": {
      "chainId": 11155111,
      "chainSelector": "ethereum-testnet-sepolia",
      "vault": "0xf68f3db7d381f6e8994445f8b6bcbe81e32820f2",
      "forwarder": "0x15fC6ae953E024d975e77382eEeC56A9101f9F88",
      "worldIdRegistry": "0xb1eA4506e10e4Be8159ABcC7A7a67C614a13A425"
    }
  }
}
```

`worldIdRegistry` — address of the `WorldIDVerifierRegistry` contract. The report is sent here (falls back to `vault` if not set).

## Setup

```bash
cd cre/verify-workflow
bun install
```

### Simulate

Run from the `cre/` directory:

```bash
cre workflow simulate verify-workflow --target=staging-settings --broadcast --non-interactive \
  --trigger-index 0 \
  --http-payload '{"action":"verify","nullifier_hash":"0x...","proof":"0x...","merkle_root":"0x...","verification_level":"orb","userAddress":"0x123..."}'
```

### Deploy to Production

```bash
cre workflow deploy verify-workflow --target=staging-settings
```
