import { spawn } from "child_process";
import path from "path";
import { config } from "./config";

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
 * Trigger the CRE workflow by spawning `cre workflow simulate`.
 * This runs the workflow logic locally via the CRE CLI.
 */
export async function sendToCRE(payload: CREPayload): Promise<unknown> {
    // Resolve path to the workflow directory
    // backend/src/lib -> ../../../cre/verify-and-order-workflow
    const workflowPath = path.resolve(__dirname, "../../../cre/verify-and-order-workflow");
    // Project root for .env
    const projectRoot = path.resolve(__dirname, "../../../cre");

    return new Promise((resolve, reject) => {
        const isWindows = process.platform === "win32";

        // On Windows with shell: true, we need to escape quotes.
        // On Unix with shell: false, we just pass the raw JSON string (node handles args).
        const inputStr = isWindows
            ? JSON.stringify(payload).replace(/"/g, '\\"')
            : JSON.stringify(payload);

        console.log(`[cre-client] Spawning simulation for action: ${payload.action} (Windows: ${isWindows})`);

        const child = spawn("cre", [
            "workflow",
            "simulate",
            workflowPath,
            "--target=staging-settings",
            "--non-interactive",
            "--trigger-index", "0",
            "--http-payload", inputStr
        ], {
            cwd: projectRoot,
            stdio: ["ignore", "pipe", "pipe"], // ignore stdin since we pass via flag
            shell: isWindows // Only use shell on Windows to find .cmd/.bat
        });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (data) => {
            stdout += data.toString();
        });

        child.stderr.on("data", (data) => {
            stderr += data.toString();
        });

        child.on("close", (code) => {
            if (code !== 0) {
                console.error(`[cre-client] Failed with stdout: ${stdout}`);
                console.error(`[cre-client] Failed with stderr: ${stderr}`);
                reject(new Error(`CRE execute failed (exit ${code}): ${stderr || stdout}`));
                return;
            }

            try {
                resolve({ output: stdout });
            } catch (e) {
                resolve({ output: stdout });
            }
        });

        // No stdin write needed
    });
}
