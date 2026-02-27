import { spawn } from "child_process";
import path from "path";
import crypto from "crypto";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config";

export interface VerifyPayload {
    action: "verify";
    nullifier_hash: string;
    proof: string;
    merkle_root: string;
    verification_level: string;
    userAddress: string;
    selectedChains?: string[];
}

export interface MatchOrderPayload {
    action:         "match_order";
    encryptedOrder: string;  // base64 ECIES ciphertext
    signature:      string;  // user ECDSA sig over encrypted payload
    pairId:         string;
    orderId:        string;
}

export type CREPayload = VerifyPayload;

// ─── Helpers for production JWT auth (CRE HTTP trigger) ───

function base64url(buf: Buffer | Uint8Array): string {
    return Buffer.from(buf)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

function sortKeysDeep(obj: unknown): unknown {
    if (Array.isArray(obj)) return obj.map(sortKeysDeep);
    if (obj !== null && typeof obj === "object") {
        return Object.keys(obj as Record<string, unknown>)
            .sort()
            .reduce((acc, key) => {
                acc[key] = sortKeysDeep((obj as Record<string, unknown>)[key]);
                return acc;
            }, {} as Record<string, unknown>);
    }
    return obj;
}

async function createCREJwt(body: object, privateKey: `0x${string}`): Promise<string> {
    const account = privateKeyToAccount(privateKey);

    // 1. Header
    const header = base64url(Buffer.from(JSON.stringify({ alg: "ETH", typ: "JWT" })));

    // 2. Compute digest: SHA-256 of the JSON body with sorted keys
    const sortedBody = JSON.stringify(sortKeysDeep(body));
    const digest = "0x" + crypto.createHash("sha256").update(sortedBody).digest("hex");

    // 3. Payload
    const now = Math.floor(Date.now() / 1000);
    const jwtPayload = {
        digest,
        iss: account.address,
        iat: now,
        exp: now + 300, // 5 min max
        jti: crypto.randomUUID(),
    };
    const payload = base64url(Buffer.from(JSON.stringify(jwtPayload)));

    // 4. Sign: Ethereum personal_sign over "<header>.<payload>"
    const message = `${header}.${payload}`;
    const signature = await account.signMessage({ message });

    // Convert hex signature to raw bytes then base64url
    const sigBytes = Buffer.from(signature.slice(2), "hex");
    const sigB64 = base64url(sigBytes);

    return `${header}.${payload}.${sigB64}`;
}

/**
 * Trigger the CRE workflow.
 *
 * - **production**: Sends an authenticated JSON-RPC request to the CRE gateway.
 * - **other envs**: Spawns `cre workflow simulate` locally via the CLI.
 */
export async function sendToCRE(payload: CREPayload, onLog?: (log: string) => void): Promise<unknown> {
    if (config.nodeEnv === "production") {
        return sendToCREProduction(payload, onLog);
    }
    return sendToCRESimulate(payload, onLog);
}

// ─── Production: HTTP trigger with JWT ───

async function sendToCREProduction(payload: CREPayload, onLog?: (log: string) => void): Promise<unknown> {
    const workflowId = config.creWorkflowId;
    if (!workflowId) {
        throw new Error("CRE_WORKFLOW_ID is required in production mode");
    }

    const requestId = crypto.randomUUID();

    const body = {
        jsonrpc: "2.0",
        id: requestId,
        method: "workflows.execute",
        params: {
            input: payload,
            workflow: { workflowID: workflowId },
        },
    };

    console.log(`[cre-client] Production: triggering workflow ${workflowId} for action: ${payload.action}`);
    if (onLog) onLog(`[cre-client] Sending to CRE gateway…`);

    const jwt = await createCREJwt(body, config.evmPrivateKey);

    const res = await fetch(config.creGatewayUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify(body),
    });

    const json = await res.json();

    if (!res.ok || json.error) {
        const errMsg = json.error?.message || JSON.stringify(json);
        console.error(`[cre-client] Gateway error: ${errMsg}`);
        if (onLog) onLog(`[cre-client] Error: ${errMsg}`);
        throw new Error(`CRE gateway error: ${errMsg}`);
    }

    console.log(`[cre-client] Workflow accepted — execution ID: ${json.result?.workflow_execution_id}`);
    if (onLog) onLog(`[cre-client] Accepted: ${json.result?.workflow_execution_id}`);

    return json.result;
}

// ─── Non-production: local CLI simulation ───

function sendToCRESimulate(payload: CREPayload, onLog?: (log: string) => void): Promise<unknown> {
    const workflowPath = path.resolve(__dirname, "../../../cre/verify-workflow");
    const projectRoot = path.resolve(__dirname, "../../../cre");

    return new Promise((resolve, reject) => {
        const isWindows = process.platform === "win32";

        const inputStr = isWindows
            ? JSON.stringify(payload).replace(/"/g, '\\"')
            : JSON.stringify(payload);

        console.log(`[cre-client] Simulation: spawning for action: ${payload.action} (Windows: ${isWindows})`);

        const child = spawn("cre", [
            "workflow",
            "simulate",
            workflowPath,
            "--target=staging-settings",
            "--non-interactive",
            "--broadcast",
            "--trigger-index", "0",
            "--http-payload", inputStr
        ], {
            cwd: projectRoot,
            stdio: ["ignore", "pipe", "pipe"],
            shell: isWindows,
        });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (data) => {
            const str = data.toString();
            console.log(`[cre-client:stdout] ${str.trim()}`);
            console.log(str);
            if (onLog) onLog(str);
            stdout += str;
        });

        child.stderr.on("data", (data) => {
            const str = data.toString();
            console.error(`[cre-client:stderr] ${str.trim()}`);
            console.error(str);
            if (onLog) onLog(str);
            stderr += str;
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
    });
}

// ─── Matching Workflow (separate workflow for TEE matching) ───────────────────

/**
 * Send a match_order payload to the CRE matching workflow (TEE).
 * - Production: uses CRE_MATCHING_WORKFLOW_ID
 * - Simulation:  spawns cre/matching-workflow locally
 */
export async function sendToMatchingWorkflow(
    payload: MatchOrderPayload,
    onLog?: (log: string) => void
): Promise<unknown> {
    if (config.nodeEnv === "production") {
        const workflowId = process.env.CRE_MATCHING_WORKFLOW_ID || "";
        if (!workflowId) throw new Error("CRE_MATCHING_WORKFLOW_ID is required in production mode");

        const requestId = crypto.randomUUID();
        const body = {
            jsonrpc: "2.0",
            id: requestId,
            method: "workflows.execute",
            params: {
                input: payload,
                workflow: { workflowID: workflowId },
            },
        };

        const jwt = await createCREJwt(body, config.evmPrivateKey);
        const res = await fetch(config.creGatewayUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
            body: JSON.stringify(body),
        });

        const json = await res.json();
        if (!res.ok || json.error) {
            throw new Error(`CRE matching gateway error: ${json.error?.message ?? JSON.stringify(json)}`);
        }
        return json.result;
    }

    return sendToMatchingWorkflowSimulate(payload, onLog);
}

function sendToMatchingWorkflowSimulate(
    payload: MatchOrderPayload,
    onLog?: (log: string) => void
): Promise<unknown> {
    const workflowPath = path.resolve(__dirname, "../../../cre/matching-workflow");
    const projectRoot = path.resolve(__dirname, "../../../cre");

    return new Promise((resolve, reject) => {
        const isWindows = process.platform === "win32";
        const inputStr = isWindows
            ? JSON.stringify(payload).replace(/"/g, '\\"')
            : JSON.stringify(payload);

        console.log(`[cre-client] Matching simulation for orderId: ${payload.orderId}`);

        const child = spawn("cre", [
            "workflow", "simulate", workflowPath,
            "--target=staging-settings",
            "--non-interactive",
            "--broadcast",
            "--trigger-index", "0",
            "--http-payload", inputStr,
        ], {
            cwd: projectRoot,
            stdio: ["ignore", "pipe", "pipe"],
            shell: isWindows,
        });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (data) => {
            const str = data.toString();
            console.log(`[matching-wf:stdout] ${str.trim()}`);
            if (onLog) onLog(str);
            stdout += str;
        });

        child.stderr.on("data", (data) => {
            const str = data.toString();
            console.error(`[matching-wf:stderr] ${str.trim()}`);
            if (onLog) onLog(str);
            stderr += str;
        });

        child.on("close", (code) => {
            if (code !== 0) {
                reject(new Error(`Matching workflow failed (exit ${code}): ${stderr || stdout}`));
                return;
            }
            resolve({ output: stdout });
        });
    });
}
