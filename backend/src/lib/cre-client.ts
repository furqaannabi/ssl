// ──────────────────────────────────────────────
// CRE HTTP Trigger Client
// ──────────────────────────────────────────────
// Signs payloads with the authorized EVM key and
// POSTs to the CRE workflow HTTP trigger endpoint.

import { createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { config } from "./config";

const account = privateKeyToAccount(config.evmPrivateKey);

const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(),
});

export interface VerifyPayload {
    action: "verify";
    nullifierHash: string;
    proof: string;
    merkle_root: string;
    credential_type: string;
    signal: string;
}

export interface OrderPayload {
    action: "order";
    nullifierHash: string;
    asset: string;
    quoteToken: string;
    amount: string;
    price: string;
    side: "BUY" | "SELL";
    stealthPublicKey: string;
}

export interface MatchPayload {
    action: "settle_match";
    buyer: {
        nullifierHash: string;
        orderId: string;
        order: {
            asset: string;
            quoteToken: string;
            amount: string;
            price: string;
            side: "BUY" | "SELL";
        };
        stealthPublicKey: string;
    };
    seller: {
        nullifierHash: string;
        orderId: string;
        order: {
            asset: string;
            quoteToken: string;
            amount: string;
            price: string;
            side: "BUY" | "SELL";
        };
        stealthPublicKey: string;
    };
}

export type CREPayload = VerifyPayload | OrderPayload | MatchPayload;

/**
 * Sign a payload and send it to the CRE HTTP trigger.
 *
 * The CRE workflow expects:
 *   - JSON body as the HTTP payload
 *   - Request signed by an authorized EVM key (matched against authorizedKeys in workflow config)
 *
 * Returns the CRE response body.
 */
export async function sendToCRE(payload: CREPayload): Promise<unknown> {
    const body = JSON.stringify(payload);

    // Sign the payload body with the authorized EVM key
    const signature = await walletClient.signMessage({
        message: body,
    });

    const res = await fetch(config.creWorkflowUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Signature": signature,
            "X-Sender": account.address,
        },
        body,
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => "unknown error");
        throw new Error(`CRE request failed (${res.status}): ${errText}`);
    }

    return res.json();
}

export { account };
