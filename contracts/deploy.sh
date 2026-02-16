#!/bin/bash
set -e

# Load env vars
if [ -f "../backend/.env" ]; then
    echo "📝 Loading environment variables from ../backend/.env..."
    export $(grep -v '^#' ../backend/.env | tr -d '\r' | xargs)
else
    echo "⚠️  ../backend/.env not found!"
    exit 1
fi

echo "🚀 Deploying contracts to Base Sepolia..."

# Delete old broadcast to force clean run
rm -rf broadcast/Deploy.s.sol

# Run Deploy script
forge script script/Deploy.s.sol:DeployScript --rpc-url baseSepolia --broadcast --verify --verifier etherscan -vvvv

# Update backend contracts.json
echo "📝 Updating backend src/contracts.json..."
BROADCAST_FILE="broadcast/Deploy.s.sol/84532/run-latest.json"

if [ ! -f "$BROADCAST_FILE" ]; then
    echo "❌ Broadcast file not found at $BROADCAST_FILE"
    exit 1
fi

extract_address() {
    local contract_name=$1
    # Use grep/sed/awk to extract address purely with shell tools (no jq dependency)
    grep -A 2 "\"contractName\": \"$contract_name\"" "$BROADCAST_FILE" | grep "\"contractAddress\"" | head -n 1 | awk -F '"' '{print $4}'
}

# Extract from broadcast
VAULT_ADDR=$(extract_address "StealthSettlementVault")

if [ -z "$VAULT_ADDR" ]; then
    echo "❌ Failed to extract Vault address."
    exit 1
fi

# Read existing token addresses from backend/src/contracts.json (simple parsing)
EXISTING_JSON="../backend/src/contracts.json"
if [ -f "$EXISTING_JSON" ]; then
    BOND_ADDR=$(grep "\"bond\":" "$EXISTING_JSON" | awk -F '"' '{print $4}')
    USDC_ADDR=$(grep "\"usdc\":" "$EXISTING_JSON" | awk -F '"' '{print $4}')
else
    # Fallback if file doesn't exist
    BOND_ADDR="0xa328fe09fd9f42c4cf95785b00876ba0bc82847a"
    USDC_ADDR="0x036CbD53842c5426634e7929541eC2318f3dCF7e"
fi

cat > "../backend/src/contracts.json" <<EOF
{
    "vault": "$VAULT_ADDR",
    "bond": "$BOND_ADDR",
    "usdc": "$USDC_ADDR"
}
EOF

# Update CRE config (using node for safe JSON manipulation)
CRE_CONFIG="../cre/verify-and-order-workflow/config.staging.json"
if [ -f "$CRE_CONFIG" ]; then
    echo "📝 Updating CRE config at $CRE_CONFIG..."
    # Create a temporary updating script
    node -e "
    const fs = require('fs');
    const path = '$CRE_CONFIG';
    try {
        const config = JSON.parse(fs.readFileSync(path, 'utf8'));
        config.vaultAddress = '$VAULT_ADDR';
        fs.writeFileSync(path, JSON.stringify(config, null, 2));
        console.log('✅ Updated vaultAddress in CRE config');
    } catch (e) {
        console.error('❌ Failed to update CRE config:', e);
        process.exit(1);
    }
    "
else
    echo "⚠️  CRE config not found at $CRE_CONFIG"
fi

echo "✅ Deployment complete! New Vault: $VAULT_ADDR"
