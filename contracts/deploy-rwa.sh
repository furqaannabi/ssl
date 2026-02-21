#!/bin/bash
set -e

# ──────────────────────────────────────────────
# SSL RWA Token Whitelist
# Whitelists already-deployed RWA tokens and USDC on the vault.
# Reads token addresses from rwa-tokens.json — no redeployment.
#
# Usage:
#   ./deploy-rwa.sh                          # whitelist on all chains
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
RWA_TOKENS_FILE="../backend/rwa-tokens.json"

if [ ! -f "$ADDRESSES_FILE" ]; then
    echo "addresses.json not found — run deploy.sh first to deploy vaults"
    exit 1
fi

if [ ! -f "$RWA_TOKENS_FILE" ]; then
    echo "rwa-tokens.json not found — no token addresses to whitelist"
    exit 1
fi

# ── Chain USDC config ──
declare -A CHAIN_USDC
CHAIN_USDC[baseSepolia]="0x036CbD53842c5426634e7929541eC2318f3dCF7e"
CHAIN_USDC[arbitrumSepolia]="0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d"

# ── Token metadata (symbol → "name|type") ──
declare -A TOKEN_META
TOKEN_META[tMETA]="SSL Tokenized Meta Platforms|0"
TOKEN_META[tGOOGL]="SSL Tokenized Alphabet Inc.|0"
TOKEN_META[tAAPL]="SSL Tokenized Apple Inc.|0"
TOKEN_META[tTSLA]="SSL Tokenized Tesla Inc.|0"
TOKEN_META[tAMZN]="SSL Tokenized Amazon.com|0"
TOKEN_META[tNVDA]="SSL Tokenized NVIDIA Corp|0"
TOKEN_META[tSPY]="SSL Tokenized S&P 500 ETF|1"
TOKEN_META[tQQQ]="SSL Tokenized Nasdaq 100 ETF|1"
TOKEN_META[tBOND]="SSL Tokenized US Treasury Bond|2"

whitelist_rwa_chain() {
    local RPC_NAME=$1

    local VAULT_ADDR=$(node -e "
        const a = require('$ADDRESSES_FILE');
        const key = Object.keys(a.chains).find(k => k.toLowerCase().includes('${RPC_NAME}'.toLowerCase()));
        if (key && a.chains[key].vault) console.log(a.chains[key].vault);
    ")

    if [ -z "$VAULT_ADDR" ]; then
        echo "No vault found for $RPC_NAME in addresses.json — skipping"
        return
    fi

    # Read token addresses for this chain from rwa-tokens.json
    local TOKENS_JSON=$(node -e "
        const fs = require('fs');
        const data = JSON.parse(fs.readFileSync('$RWA_TOKENS_FILE', 'utf8'));
        const key = Object.keys(data.chains || {}).find(k => k.toLowerCase().includes('${RPC_NAME}'.toLowerCase()));
        if (key && data.chains[key].tokens) {
            console.log(JSON.stringify(data.chains[key].tokens));
        } else {
            console.log('{}');
        }
    ")

    echo ""
    echo "========================================"
    echo "  Whitelisting RWA Tokens on $RPC_NAME"
    echo "  Vault: $VAULT_ADDR"
    echo "========================================"

    # Whitelist each RWA token
    for SYMBOL in tMETA tGOOGL tAAPL tTSLA tAMZN tNVDA tSPY tQQQ tBOND; do
        local TOKEN_ADDR=$(node -e "
            const tokens = $TOKENS_JSON;
            if (tokens['$SYMBOL']) console.log(tokens['$SYMBOL']);
        ")

        if [ -z "$TOKEN_ADDR" ]; then
            echo "  $SYMBOL: not found in rwa-tokens.json — skipping"
            continue
        fi

        local META="${TOKEN_META[$SYMBOL]}"
        local TOKEN_NAME="${META%|*}"
        local TOKEN_TYPE="${META#*|}"

        echo "  Whitelisting $SYMBOL ($TOKEN_ADDR) type=$TOKEN_TYPE..."
        cast send "$VAULT_ADDR" \
            "whitelistToken(address,string,string,uint8)" \
            "$TOKEN_ADDR" "$SYMBOL" "$TOKEN_NAME" "$TOKEN_TYPE" \
            --private-key "$PRIVATE_KEY" \
            --rpc-url "$RPC_NAME" \
            || echo "    ($SYMBOL may already be whitelisted — continuing)"
    done

    # Whitelist USDC
    local USDC="${CHAIN_USDC[$RPC_NAME]}"
    if [ -n "$USDC" ]; then
        echo "  Whitelisting USDC ($USDC) type=4..."
        cast send "$VAULT_ADDR" \
            "whitelistToken(address,string,string,uint8)" \
            "$USDC" "USDC" "USD Coin" 4 \
            --private-key "$PRIVATE_KEY" \
            --rpc-url "$RPC_NAME" \
            || echo "    (USDC may already be whitelisted — continuing)"
    fi

    echo ""
    echo "=== $RPC_NAME whitelist complete ==="
}

# ── Main ──

if [ -n "$CHAIN" ]; then
    whitelist_rwa_chain "$CHAIN"
else
    for chain in baseSepolia arbitrumSepolia; do
        whitelist_rwa_chain "$chain"
    done
fi

echo ""
echo "=== All chains whitelisted ==="
