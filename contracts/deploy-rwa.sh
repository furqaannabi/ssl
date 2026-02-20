#!/bin/bash
set -e

# ──────────────────────────────────────────────
# SSL RWA Token Deploy
# Deploys all mock RWA tokens (tMETA, tGOOGL, etc.)
# and whitelists them on the vault. Also whitelists USDC.
#
# Usage:
#   ./deploy-rwa.sh                          # deploy to all chains
#   CHAIN=baseSepolia ./deploy-rwa.sh        # single chain
#   CHAIN=arbitrumSepolia ./deploy-rwa.sh
# ──────────────────────────────────────────────

# ── Load env ──
if [ -f "../backend/.env" ]; then
    echo "Loading env from ../backend/.env..."
    export $(grep -v '^#' ../backend/.env | tr -d '\r' | xargs)
else
    echo "../backend/.env not found!"
    exit 1
fi

if [ -z "$PRIVATE_KEY" ] && [ -n "$EVM_PRIVATE_KEY" ]; then
    export PRIVATE_KEY="$EVM_PRIVATE_KEY"
fi

if [ -z "$PRIVATE_KEY" ]; then
    echo "PRIVATE_KEY (or EVM_PRIVATE_KEY) is required"
    exit 1
fi

ADDRESSES_FILE="../backend/addresses.json"

if [ ! -f "$ADDRESSES_FILE" ]; then
    echo "addresses.json not found — run deploy.sh first to deploy vaults"
    exit 1
fi

# ── Chain config ──
declare -A CHAIN_USDC
CHAIN_USDC[baseSepolia]="0x036CbD53842c5426634e7929541eC2318f3dCF7e"
CHAIN_USDC[arbitrumSepolia]="0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d"

RWA_TOKENS_FILE="../backend/rwa-tokens.json"

extract_address() {
    local name=$1 file=$2
    grep -A 2 "\"contractName\": \"$name\"" "$file" \
        | grep "\"contractAddress\"" | head -n 1 | awk -F '"' '{print $4}'
}

deploy_rwa_chain() {
    local RPC_NAME=$1

    # Read vault address from addresses.json
    local VAULT_ADDR=$(node -e "
        const a = require('$ADDRESSES_FILE');
        const key = Object.keys(a.chains).find(k => k.toLowerCase().includes('${RPC_NAME}'.toLowerCase()));
        if (key && a.chains[key].vault) console.log(a.chains[key].vault);
    ")

    if [ -z "$VAULT_ADDR" ]; then
        echo "No vault found for $RPC_NAME in addresses.json — skipping"
        return
    fi

    local USDC=${CHAIN_USDC[$RPC_NAME]}
    local CHAIN_ID=$(node -e "
        const a = require('$ADDRESSES_FILE');
        const key = Object.keys(a.chains).find(k => k.toLowerCase().includes('${RPC_NAME}'.toLowerCase()));
        if (key) console.log(a.chains[key].chainId);
    ")

    echo ""
    echo "========================================"
    echo "  Deploying RWA Tokens to $RPC_NAME"
    echo "  Vault: $VAULT_ADDR"
    echo "  Chain ID: $CHAIN_ID"
    echo "========================================"

    # Deploy RWA tokens via forge script
    export VAULT_ADDRESS="$VAULT_ADDR"

    rm -rf "broadcast/DeployRWATokens.s.sol/$CHAIN_ID"

    forge script script/DeployRWATokens.s.sol:DeployRWATokens \
        --rpc-url "$RPC_NAME" \
        --broadcast \
        -vvvv

    BROADCAST_FILE="broadcast/DeployRWATokens.s.sol/$CHAIN_ID/run-latest.json"

    if [ ! -f "$BROADCAST_FILE" ]; then
        echo "Broadcast file not found: $BROADCAST_FILE"
        exit 1
    fi

    # Extract deployed token addresses from broadcast
    echo ""
    echo "Extracting deployed token addresses..."

    local TOKENS_JSON="{"
    for SYMBOL in tMETA tGOOGL tAAPL tTSLA tAMZN tNVDA tSPY tQQQ tBOND; do
        # MockRWAToken contracts are all named "MockRWAToken" in broadcast
        # We need to extract them in order from the transactions
        true
    done

    # Parse all MockRWAToken deployments from broadcast in order
    local TOKEN_ADDRS=$(node -e "
        const fs = require('fs');
        const b = JSON.parse(fs.readFileSync('$BROADCAST_FILE', 'utf8'));
        const creates = b.transactions
            .filter(t => t.transactionType === 'CREATE' && t.contractName === 'MockRWAToken')
            .map(t => t.contractAddress);
        console.log(JSON.stringify(creates));
    ")

    local SYMBOLS=("tMETA" "tGOOGL" "tAAPL" "tTSLA" "tAMZN" "tNVDA" "tSPY" "tQQQ" "tBOND")

    echo ""
    echo "Deployed RWA Tokens:"
    echo "────────────────────"

    node -e "
        const fs = require('fs');
        const addrs = $TOKEN_ADDRS;
        const symbols = $(node -e "console.log(JSON.stringify(['tMETA','tGOOGL','tAAPL','tTSLA','tAMZN','tNVDA','tSPY','tQQQ','tBOND']))");
        const result = {};
        symbols.forEach((s, i) => {
            if (addrs[i]) {
                result[s] = addrs[i];
                console.log('  ' + s + ': ' + addrs[i]);
            }
        });

        // Write to rwa-tokens.json
        const file = '$RWA_TOKENS_FILE';
        let data = {};
        if (fs.existsSync(file)) data = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!data.chains) data.chains = {};
        data.chains['$RPC_NAME'] = {
            chainId: $CHAIN_ID,
            vault: '$VAULT_ADDR',
            tokens: result
        };
        fs.writeFileSync(file, JSON.stringify(data, null, 4));
    "

    echo ""
    echo "Saved to rwa-tokens.json"

    # Whitelist USDC on the vault
    if [ -n "$USDC" ]; then
        echo ""
        echo "Whitelisting USDC ($USDC) on vault..."
        cast send "$VAULT_ADDR" \
            "whitelistToken(address,string,string,uint8)" \
            "$USDC" "USDC" "USD Coin" 4 \
            --private-key "$PRIVATE_KEY" \
            --rpc-url "$RPC_NAME" \
            || echo "  (USDC may already be whitelisted — continuing)"
        echo "USDC whitelisted"
    fi

    echo ""
    echo "=== $RPC_NAME RWA deployment complete ==="
}

# ── Main ──

if [ -n "$CHAIN" ]; then
    deploy_rwa_chain "$CHAIN"
else
    for chain in baseSepolia arbitrumSepolia; do
        deploy_rwa_chain "$chain"
    done
fi

echo ""
echo "=== All RWA deployments complete ==="

if [ -f "$RWA_TOKENS_FILE" ]; then
    echo ""
    cat "$RWA_TOKENS_FILE"
fi
