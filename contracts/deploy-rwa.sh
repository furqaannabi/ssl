#!/bin/bash
set -e

# ──────────────────────────────────────────────
# SSL RWA Token Deploy + Whitelist
# Deploys MockRWAToken contracts and batch-whitelists them
# on the vault in one forge script call. Saves deployed
# addresses to rwa-tokens.json for backend consumption.
#
# Requires vault to already be deployed (run deploy.sh first).
#
# Usage:
#   ./deploy-rwa.sh                          # all chains
#   CHAIN=baseSepolia ./deploy-rwa.sh        # single chain
#   CHAIN=arbitrumSepolia ./deploy-rwa.sh
#   CHAIN=ethSepolia ./deploy-rwa.sh
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

# ── Chain IDs ──
declare -A CHAIN_IDS
CHAIN_IDS[baseSepolia]=84532
CHAIN_IDS[arbitrumSepolia]=421614
CHAIN_IDS[ethSepolia]=11155111

deploy_rwa_chain() {
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

    echo ""
    echo "========================================"
    echo "  Deploying RWA Tokens on $RPC_NAME"
    echo "  Chain ID : $CHAIN_ID"
    echo "  Vault    : $VAULT_ADDR"
    echo "========================================"

    rm -rf "broadcast/DeployRWATokens.s.sol/$CHAIN_ID"

    VAULT_ADDRESS="$VAULT_ADDR" forge script script/DeployRWATokens.s.sol:DeployRWATokens \
        --rpc-url "$RPC_NAME" \
        --broadcast \
        --slow \
        -vvvv

    local BROADCAST_FILE="broadcast/DeployRWATokens.s.sol/$CHAIN_ID/run-latest.json"

    if [ ! -f "$BROADCAST_FILE" ]; then
        echo "Broadcast file not found: $BROADCAST_FILE"
        exit 1
    fi

    echo ""
    echo "  Extracting deployed addresses and updating rwa-tokens.json..."

    node -e "
const fs = require('fs');
const broadcast = JSON.parse(fs.readFileSync('$BROADCAST_FILE', 'utf8'));

// MockRWAToken creates appear in deployment order.
// contractName may be fully qualified (e.g. "src/mocks/MockRWAToken.sol:MockRWAToken")
// in newer Foundry versions, so match by suffix.
const creates = broadcast.transactions
    .filter(tx => tx.transactionType === 'CREATE' && tx.contractName && tx.contractName.includes('MockRWAToken'))
    .map(tx => tx.contractAddress.toLowerCase());

console.log('Found ' + creates.length + ' MockRWAToken creates in broadcast');

const symbols = ['tMETA','tGOOGL','tAAPL','tTSLA','tAMZN','tNVDA','tSPY','tQQQ','tBOND'];
const tokens = {};
symbols.forEach((sym, i) => { if (creates[i]) tokens[sym] = creates[i]; });

const f = '$RWA_TOKENS_FILE';
const data = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { chains: {} };
if (!data.chains) data.chains = {};
data.chains['$RPC_NAME'] = {
    chainId: $CHAIN_ID,
    vault: '$VAULT_ADDR',
    tokens,
};
fs.writeFileSync(f, JSON.stringify(data, null, 4));

console.log('Updated rwa-tokens.json for $RPC_NAME:');
Object.entries(tokens).forEach(([sym, addr]) => console.log('  ' + sym + ': ' + addr));
"

    echo ""
    echo "=== $RPC_NAME deploy complete ==="
}

# ── Main ──

if [ -n "$CHAIN" ]; then
    deploy_rwa_chain "$CHAIN"
else
    for chain in baseSepolia arbitrumSepolia ethSepolia; do
        deploy_rwa_chain "$chain"
    done
fi

echo ""
echo "=== All chains complete ==="
cat "$RWA_TOKENS_FILE"
