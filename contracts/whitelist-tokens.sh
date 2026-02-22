#!/bin/bash
set -e

# ──────────────────────────────────────────────
# SSL Token Whitelist
# Reads deployed token addresses from rwa-tokens.json
# and whitelists them on the vault without redeploying.
#
# Usage:
#   ./whitelist-tokens.sh                          # all chains
#   CHAIN=baseSepolia ./whitelist-tokens.sh        # single chain
#   CHAIN=arbitrumSepolia ./whitelist-tokens.sh
#   CHAIN=ethSepolia ./whitelist-tokens.sh
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
    echo "addresses.json not found"
    exit 1
fi

if [ ! -f "$RWA_TOKENS_FILE" ]; then
    echo "rwa-tokens.json not found — run deploy-rwa.sh first to deploy tokens"
    exit 1
fi

# ── Chain IDs ──
declare -A CHAIN_IDS
CHAIN_IDS[baseSepolia]=84532
CHAIN_IDS[arbitrumSepolia]=421614
CHAIN_IDS[ethSepolia]=11155111

whitelist_chain() {
    local RPC_NAME=$1
    local CHAIN_ID="${CHAIN_IDS[$RPC_NAME]}"

    if [ -z "$CHAIN_ID" ]; then
        echo "Unknown chain: $RPC_NAME"
        exit 1
    fi

    local VAULT_ADDR=$(node -e "
        const a = require('$ADDRESSES_FILE');
        const entry = a.chains['$RPC_NAME'];
        if (entry && entry.vault) process.stdout.write(entry.vault);
    ")

    if [ -z "$VAULT_ADDR" ]; then
        echo "No vault found for $RPC_NAME in addresses.json — skipping"
        return
    fi

    # Build comma-separated token arrays from rwa-tokens.json + USDC from addresses.json
    local TOKEN_VARS
    TOKEN_VARS=$(node -e "
const fs = require('fs');
const rwa  = JSON.parse(fs.readFileSync('$RWA_TOKENS_FILE', 'utf8'));
const addr = JSON.parse(fs.readFileSync('$ADDRESSES_FILE',  'utf8'));

const chainData = rwa.chains['$RPC_NAME'];
if (!chainData || !chainData.tokens) {
    console.error('No token data for $RPC_NAME in rwa-tokens.json');
    process.exit(1);
}

const META = {
    tMETA:  { name: 'SSL Tokenized Meta Platforms',   type: 0 },
    tGOOGL: { name: 'SSL Tokenized Alphabet Inc.',    type: 0 },
    tAAPL:  { name: 'SSL Tokenized Apple Inc.',       type: 0 },
    tTSLA:  { name: 'SSL Tokenized Tesla Inc.',       type: 0 },
    tAMZN:  { name: 'SSL Tokenized Amazon.com',       type: 0 },
    tNVDA:  { name: 'SSL Tokenized NVIDIA Corp',      type: 0 },
    tSPY:   { name: 'SSL Tokenized S&P 500 ETF',      type: 1 },
    tQQQ:   { name: 'SSL Tokenized Nasdaq 100 ETF',   type: 1 },
    tBOND:  { name: 'SSL Tokenized US Treasury Bond', type: 2 },
    USDC:   { name: 'USD Coin',                       type: 4 },
};

const tokens = { ...chainData.tokens };

// Append USDC from addresses.json if present
const usdcAddr = addr.chains['$RPC_NAME']?.usdc;
if (usdcAddr) tokens['USDC'] = usdcAddr;

const addresses = [], symbols = [], names = [], types = [];
for (const [sym, tokenAddr] of Object.entries(tokens)) {
    const m = META[sym] || { name: sym, type: 0 };
    addresses.push(tokenAddr);
    symbols.push(sym);
    names.push(m.name);
    types.push(m.type);
}

process.stdout.write(
    'TOKEN_ADDRESSES=' + addresses.join(',') + '\n' +
    'TOKEN_SYMBOLS='   + symbols.join(',')   + '\n' +
    'TOKEN_NAMES='     + names.join(',')     + '\n' +
    'TOKEN_TYPES='     + types.join(',')     + '\n'
);
")

    if [ -z "$TOKEN_VARS" ]; then
        echo "No tokens found for $RPC_NAME — skipping"
        return
    fi

    # Export each TOKEN_* var
    while IFS= read -r line; do
        [ -n "$line" ] && export "$line"
    done <<< "$TOKEN_VARS"

    echo ""
    echo "========================================"
    echo "  Whitelisting tokens on $RPC_NAME"
    echo "  Chain ID : $CHAIN_ID"
    echo "  Vault    : $VAULT_ADDR"
    echo "========================================"

    VAULT_ADDRESS="$VAULT_ADDR" forge script script/WhitelistTokens.s.sol:WhitelistTokens \
        --rpc-url "$RPC_NAME" \
        --broadcast \
        --slow \
        -vvv

    echo ""
    echo "=== $RPC_NAME whitelist complete ==="
}

# ── Main ──
if [ -n "$CHAIN" ]; then
    whitelist_chain "$CHAIN"
else
    for chain in baseSepolia arbitrumSepolia ethSepolia; do
        whitelist_chain "$chain"
    done
fi

echo ""
echo "=== All chains complete ==="
