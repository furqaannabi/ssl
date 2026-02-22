#!/bin/bash
set -e

# ──────────────────────────────────────────────
# SSL Multi-Chain Deploy
# Deploys StealthSettlementVault to any chain.
# Deploy.s.sol auto-resolves forwarder & router
# from SSLChains library based on the RPC chain.
#
# Usage:
#   ./deploy.sh                   # both chains
#   CHAIN=baseSepolia ./deploy.sh # single chain
#   CHAIN=arbitrumSepolia ./deploy.sh
# ──────────────────────────────────────────────

if [ -f "../backend/.env" ]; then
    echo "Loading env from ../backend/.env..."
    export $(grep -v '^#' ../backend/.env | tr -d '\r' | xargs)
else
    echo "../backend/.env not found!"
    exit 1
fi

ADDRESSES_FILE="../backend/addresses.json"

if [ ! -f "$ADDRESSES_FILE" ]; then
    echo '{"chains":{}}' > "$ADDRESSES_FILE"
fi

# ── Known chains ──
# Format: NAME  CHAIN_ID|CHAIN_SELECTOR|CCIP_SELECTOR|USDC|LINK|CCIP_ROUTER|FORWARDER|INFURA_SLUG

declare -A CHAINS
CHAINS[baseSepolia]="84532|ethereum-testnet-sepolia-base-1|10344971235874465080|0x036CbD53842c5426634e7929541eC2318f3dCF7e|0xE4aB69C077896252FAFBD49EFD26B5D171A32410|0xD3b06cEbF099CE7DA4AcCf578aaEBFDBd6e88a93|0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5|base-sepolia"
CHAINS[arbitrumSepolia]="421614|ethereum-testnet-sepolia-arbitrum-1|3478487238524512106|0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d|0xb1D4538B4571d411F07960EF2838Ce337FE1E80E|0x2a9C5afB0d0e4BAb2BCdaE109EC4b0c4Be15a165|0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5|arbitrum-sepolia"
CHAINS[ethSepolia]="11155111|ethereum-testnet-sepolia|16015286601757825753|0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d|0x779877A7B0D9E8603169DdbD7836e478b4624789|0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59|0x15fC6ae953E024d975e77382eEeC56A9101f9F88|sepolia"

extract_address() {
    local name=$1 file=$2
    grep -A 2 "\"contractName\": \"$name\"" "$file" \
        | grep "\"contractAddress\"" | head -n 1 | awk -F '"' '{print $4}'
}

deploy_chain() {
    local RPC_NAME=$1
    local DATA=${CHAINS[$RPC_NAME]}

    if [ -z "$DATA" ]; then
        echo "Unknown chain: $RPC_NAME"
        exit 1
    fi

    IFS='|' read -r CHAIN_ID CHAIN_SEL CCIP_SEL USDC LINK CCIP_ROUTER FORWARDER INFURA_SLUG <<< "$DATA"

    echo ""
    echo "========================================"
    echo "  Deploying to $RPC_NAME (chainId=$CHAIN_ID)"
    echo "========================================"

    rm -rf "broadcast/Deploy.s.sol/$CHAIN_ID"

    forge script script/Deploy.s.sol:DeployScript \
        --rpc-url "$RPC_NAME" \
        --broadcast \
        --slow \
        --verify \
        -vvvv

    BROADCAST_FILE="broadcast/Deploy.s.sol/$CHAIN_ID/run-latest.json"

    if [ ! -f "$BROADCAST_FILE" ]; then
        echo "Broadcast file not found: $BROADCAST_FILE"
        exit 1
    fi

    local VAULT_ADDR=$(extract_address "StealthSettlementVault" "$BROADCAST_FILE")
    local RECEIVER_ADDR=$(extract_address "SSLCCIPReceiver" "$BROADCAST_FILE")

    if [ -z "$VAULT_ADDR" ]; then
        echo "Failed to extract vault address"
        exit 1
    fi

    echo "Vault: $VAULT_ADDR"
    echo "CCIP Receiver: $RECEIVER_ADDR"

    # Write to addresses.json
    node -e "
    const fs = require('fs');
    const f = '$ADDRESSES_FILE';
    const a = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!a.chains) a.chains = {};
    a.chains['$RPC_NAME'] = {
        chainId: $CHAIN_ID,
        chainSelector: '$CHAIN_SEL',
        ccipChainSelector: '$CCIP_SEL',
        vault: '$VAULT_ADDR',
        ccipReceiver: '$RECEIVER_ADDR',
        usdc: '$USDC',
        link: '$LINK',
        ccipRouter: '$CCIP_ROUTER',
        forwarder: '$FORWARDER',
        rpcUrl: 'https://$INFURA_SLUG.infura.io/v3/',
        wsUrl: 'wss://$INFURA_SLUG.infura.io/ws/v3/'
    };
    fs.writeFileSync(f, JSON.stringify(a, null, 4));
    "

    echo "Updated addresses.json for $RPC_NAME"

    # Update CRE config (same chains structure)
    CRE_CONFIG="../cre/verify-and-order-workflow/config.staging.json"
    if [ -f "$CRE_CONFIG" ]; then
        node -e "
        const fs = require('fs');
        const c = JSON.parse(fs.readFileSync('$CRE_CONFIG','utf8'));
        if (!c.chains) c.chains = {};
        if (!c.chains['$RPC_NAME']) c.chains['$RPC_NAME'] = {};
        c.chains['$RPC_NAME'].vault = '$VAULT_ADDR';
        c.chains['$RPC_NAME'].ccipReceiver = '$RECEIVER_ADDR';
        c.chains['$RPC_NAME'].chainSelector = '$CHAIN_SEL';
        c.chains['$RPC_NAME'].ccipChainSelector = '$CCIP_SEL';
        c.chains['$RPC_NAME'].usdc = '$USDC';
        c.chains['$RPC_NAME'].link = '$LINK';
        c.chains['$RPC_NAME'].ccipRouter = '$CCIP_ROUTER';
        c.chains['$RPC_NAME'].forwarder = '$FORWARDER';
        c.chains['$RPC_NAME'].chainId = $CHAIN_ID;
        fs.writeFileSync('$CRE_CONFIG', JSON.stringify(c, null, 2));
        "
        echo "Updated CRE config for $RPC_NAME"
    fi
}

# ── Main ──

if [ -n "$CHAIN" ]; then
    deploy_chain "$CHAIN"
else
    for chain in baseSepolia arbitrumSepolia ethSepolia; do
        deploy_chain "$chain"
    done
fi

echo ""
echo "=== All deployments complete ==="
cat "$ADDRESSES_FILE"
