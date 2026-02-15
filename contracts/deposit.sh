#!/bin/bash
set -e

# Load environment variables from backend .env
if [ -f "../backend/.env" ]; then
    echo "📝 Loading environment variables from ../backend/.env..."
    # Export variables from .env file
    export $(grep -v '^#' ../backend/.env | tr -d '\r' | xargs)
else
    echo "⚠️  ../backend/.env not found!"
    exit 1
fi

echo "💰 Depositing into Vault..."
echo "   Vault: $SSL_VAULT_ADDRESS"
echo "   Token: $MOCK_USDC_TOKEN"

# Run forge script
# Set required env vars for the script
export VAULT_ADDRESS=$SSL_VAULT_ADDRESS
export TOKEN_ADDRESS=$MOCK_USDC_TOKEN
export AMOUNT=100000000 # 100 USDC (6 decimals)
export NULLIFIER_HASH=0x1234567890123456789012345678901234567890123456789012345678901234
export PRIVATE_KEY=$EVM_PRIVATE_KEY

forge script script/Deposit.s.sol:DepositScript --rpc-url baseSepolia --broadcast --verify --verifier etherscan -vvvv
