/**
 * Convergence API Client
 *
 * Handles EIP-712 signed requests to the Convergence private token vault
 * on Ethereum Sepolia. The backend service wallet acts as the settlement
 * operator: it holds pooled balances and executes private-transfers at
 * match time so that buyers/sellers receive tokens to their stealth addresses
 * without any balance records being stored in our own database.
 *
 * Contract: 0xE588a6c73933BFD66Af9b4A07d48bcE59c0D2d13 (ETH Sepolia)
 * Docs:     https://convergence2026-token-api.cldev.cloud/docs
 */

import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { config } from "./config";

// ─── Constants ────────────────────────────────────────────────────────────────

export const CONVERGENCE_API   = "https://convergence2026-token-api.cldev.cloud";
export const CONVERGENCE_CONTRACT: `0x${string}` = "0xE588a6c73933BFD66Af9b4A07d48bcE59c0D2d13";
export const CONVERGENCE_CHAIN_ID = 11155111; // ETH Sepolia

// ─── EIP-712 Domain ────────────────────────────────────────────────────────────

const EIP712_DOMAIN = {
    name:              "CompliantPrivateTokenDemo",
    version:           "0.0.1",
    chainId:           CONVERGENCE_CHAIN_ID,
    verifyingContract: CONVERGENCE_CONTRACT,
} as const;

// ─── EIP-712 Type Definitions ─────────────────────────────────────────────────

const TRANSFER_TYPES = {
    "Private Token Transfer": [
        { name: "sender",    type: "address"  },
        { name: "recipient", type: "address"  },
        { name: "token",     type: "address"  },
        { name: "amount",    type: "uint256"  },
        { name: "flags",     type: "string[]" },
        { name: "timestamp", type: "uint256"  },
    ],
} as const;

const BALANCES_TYPES = {
    "Retrieve Balances": [
        { name: "account",   type: "address" },
        { name: "timestamp", type: "uint256" },
    ],
} as const;


// ─── Service Wallet ───────────────────────────────────────────────────────────

function getServiceAccount() {
    return privateKeyToAccount(config.evmPrivateKey);
}

function getWalletClient() {
    return createWalletClient({
        account:   getServiceAccount(),
        chain:     sepolia,
        transport: http(),
    });
}

/** Returns the service wallet's Ethereum address (the DEX operator account on convergence). */
export function getServiceWalletAddress(): string {
    return getServiceAccount().address;
}

// ─── Signing Helpers ──────────────────────────────────────────────────────────

async function signPrivateTransfer(params: {
    sender:    `0x${string}`;
    recipient: `0x${string}`;
    token:     `0x${string}`;
    amount:    bigint;
    flags:     string[];
    timestamp: number;
}): Promise<`0x${string}`> {
    const client = getWalletClient();
    return client.signTypedData({
        domain:      EIP712_DOMAIN,
        types:       TRANSFER_TYPES,
        primaryType: "Private Token Transfer",
        message: {
            sender:    params.sender,
            recipient: params.recipient,
            token:     params.token,
            amount:    params.amount,
            flags:     params.flags,
            timestamp: BigInt(params.timestamp),
        },
    });
}

async function signRetrieveBalances(params: {
    account:   `0x${string}`;
    timestamp: number;
}): Promise<`0x${string}`> {
    const client = getWalletClient();
    return client.signTypedData({
        domain:      EIP712_DOMAIN,
        types:       BALANCES_TYPES,
        primaryType: "Retrieve Balances",
        message: {
            account:   params.account,
            timestamp: BigInt(params.timestamp),
        },
    });
}

// ─── Public API Functions ─────────────────────────────────────────────────────

export interface TokenBalance {
    token:  string;
    amount: string;
}

/**
 * Query the service wallet's token balances on the Convergence vault.
 * Useful for monitoring operator liquidity.
 */
export async function getServiceWalletBalances(): Promise<TokenBalance[]> {
    const account   = getServiceAccount();
    const timestamp = Math.floor(Date.now() / 1000);
    const auth      = await signRetrieveBalances({ account: account.address, timestamp });

    const res = await fetch(`${CONVERGENCE_API}/balances`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            account:   account.address,
            timestamp,
            auth,
        }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`[convergence] getBalances failed: ${JSON.stringify(err)}`);
    }

    const json = await res.json();
    return json.balances ?? [];
}

/**
 * Execute a private token transfer FROM the service wallet to a recipient.
 * The service wallet is the operator/custodian; buyers and sellers receive
 * their tokens here at settlement time.
 */
export async function privateTransferFromService(params: {
    recipient: string;
    token:     string;
    amount:    string;    // uint256 wei string
    flags?:    string[];
}): Promise<{ transaction_id: string }> {
    const account   = getServiceAccount();
    const sender    = account.address;
    const timestamp = Math.floor(Date.now() / 1000);
    const flags     = params.flags ?? ["hide-sender"];

    const auth = await signPrivateTransfer({
        sender,
        recipient: params.recipient as `0x${string}`,
        token:     params.token     as `0x${string}`,
        amount:    BigInt(params.amount),
        flags,
        timestamp,
    });

    const res = await fetch(`${CONVERGENCE_API}/private-transfer`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            account:   sender,
            recipient: params.recipient,
            token:     params.token,
            amount:    params.amount,
            flags,
            timestamp,
            auth,
        }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
            `[convergence] private-transfer failed: ${err.error ?? JSON.stringify(err)}`
        );
    }

    return res.json();
}

/**
 * Settle a matched order pair via two Convergence private-transfers:
 *   1. Base token (RWA) → buyer's stealth address
 *   2. Quote token (USDC) → seller's stealth address
 *
 * Both transfers originate from the service wallet.
 * Returns the transaction IDs from the Convergence API.
 */
export async function settleMatch(params: {
    buyerShieldAddress:  string;
    sellerShieldAddress: string;
    baseTokenAddress:     string;
    quoteTokenAddress:    string;
    baseAmountWei:        string;
    quoteAmountWei:       string;
}, onLog?: (log: string) => void): Promise<{ buyerTxId: string; sellerTxId: string }> {
    onLog?.(`[convergence] Transferring ${params.baseAmountWei} base token → buyer ${params.buyerShieldAddress.slice(0, 8)}...`);

    const buyerResult = await privateTransferFromService({
        recipient: params.buyerShieldAddress,
        token:     params.baseTokenAddress,
        amount:    params.baseAmountWei,
        flags:     ["hide-sender"],
    });

    onLog?.(`[convergence] Buyer tx: ${buyerResult.transaction_id}`);
    onLog?.(`[convergence] Transferring ${params.quoteAmountWei} USDC → seller ${params.sellerShieldAddress.slice(0, 8)}...`);

    const sellerResult = await privateTransferFromService({
        recipient: params.sellerShieldAddress,
        token:     params.quoteTokenAddress,
        amount:    params.quoteAmountWei,
        flags:     ["hide-sender"],
    });

    onLog?.(`[convergence] Seller tx: ${sellerResult.transaction_id}`);

    return {
        buyerTxId:  buyerResult.transaction_id,
        sellerTxId: sellerResult.transaction_id,
    };
}

/**
 * Generate a shielded address for a user on the Convergence vault.
 *
 * The user signs the EIP-712 "Generate Shielded Address" request client-side
 * (via wagmi useSignTypedData) and passes the resulting signature to the backend,
 * which proxies it to the Convergence API.
 *
 * The returned shielded address looks like a normal 0x address but is resolved
 * server-side back to the user's EOA when receiving private transfers.
 *
 * @param account   - User's EOA address (checksummed)
 * @param auth      - EIP-712 signature from the user's wallet
 * @param timestamp - Unix timestamp used when signing (must be within 5 minutes)
 */
export async function generateUserShieldedAddress(params: {
    account:   string;
    auth:      string;
    timestamp: number;
}): Promise<string> {
    const res = await fetch(`${CONVERGENCE_API}/shielded-address`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            account:   params.account,
            timestamp: params.timestamp,
            auth:      params.auth,
        }),
    });

    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
            `[convergence] shielded-address failed: ${err.error ?? JSON.stringify(err)}`
        );
    }

    const json = await res.json();
    if (!json.address) throw new Error("[convergence] No address in shielded-address response");
    return json.address as string;
}

