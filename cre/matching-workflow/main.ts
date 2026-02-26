/**
 * SSL Matching Workflow — CRE TEE Implementation
 *
 * This workflow runs inside a Chainlink Trusted Execution Environment (TEE).
 * It:
 *  1. Decrypts incoming encrypted orders (only the TEE has the private key)
 *  2. Fetches all open encrypted orders from the backend via Confidential HTTP
 *  3. Decrypts every resting order inside the TEE
 *  4. Runs price-time priority matching in-memory (invisible to operators)
 *  5. On match: notifies the backend to settle via the Convergence API
 *  6. Returns the match result to the backend
 *
 * Encryption scheme: secp256k1 ECIES (ECDH + SHA-256 + AES-256-GCM)
 *   Ciphertext format: compressed_ephemeral_pubkey(33) | iv(12) | gcm_ciphertext
 */

import {
  HTTPCapability,
  handler,
  Runner,
  type Runtime,
  type HTTPPayload,
  decodeJson,
  HTTPClient,
  HTTPSendRequester,
  consensusIdenticalAggregation,
  EVMClient,
  getNetwork,
  hexToBase64,
} from "@chainlink/cre-sdk";

import { encodeFunctionData, decodeAbiParameters } from "viem";
import { secp256k1 } from "@noble/curves/secp256k1";
import { gcm }       from "@noble/ciphers/aes";
import { sha256 }    from "@noble/hashes/sha256";

// ─── Config ──────────────────────────────────────────────────────────────────

type Config = {
  /** EVM address allowed to trigger this workflow. */
  authorizedEVMAddress: string;
  /** Compressed secp256k1 public key (hex) — published so frontend can encrypt orders. */
  creEncryptionPublicKey: string;
  /**
   * secp256k1 private key (hex) — used to decrypt orders inside the TEE.
   * Staging: stored here for simulation convenience.
   * Production: inject via secrets.yaml so it never leaves the enclave.
   */
  creDecryptionKey: string;
  /** Backend API base URL, e.g. http://localhost:3001 */
  backendUrl: string;
  /** Shared secret for CRE → backend settlement callback authentication. */
  callbackSecret: string;
  /**
   * WorldIDVerifierRegistry address on ETH Sepolia.
   * Set after running 03_DeployWorldIDPolicy.s.sol.
   * When set, both buyer and seller userAddresses are checked before settlement.
   */
  worldIdRegistry?: string;
  /** ETH Sepolia chain selector name for EVMClient registry reads. */
  ethSepoliaChainSelector?: string;
};

// ─── WorldID registry check ──────────────────────────────────────────────────

const IS_VERIFIED_ABI = [{
  name: "isVerified",
  type: "function",
  inputs: [{ name: "", type: "address" }],
  outputs: [{ name: "", type: "bool" }],
  stateMutability: "view",
}] as const;

/**
 * Read isVerified(userAddress) from the WorldIDVerifierRegistry on-chain.
 * Always checks the NORMAL (EOA) address — NOT the shield/stealth address.
 * Returns true if verified, false on any error or if registry not configured.
 */
function checkIsVerifiedOnChain(runtime: Runtime<Config>, userAddress: string): boolean {
  const registryAddress = runtime.config.worldIdRegistry;
  if (!registryAddress) {
    runtime.log("[TEE] worldIdRegistry not configured — skipping isVerified check");
    return true; // allow if not configured (registry not yet deployed)
  }

  const chainSelector = runtime.config.ethSepoliaChainSelector || "ethereum-testnet-sepolia";
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: chainSelector,
    isTestnet: true,
  });

  if (!network) {
    runtime.log("[TEE] Network not found for isVerified check — skipping");
    return true;
  }

  const evmClient = new EVMClient(network.chainSelector.selector);

  const callData = encodeFunctionData({
    abi: IS_VERIFIED_ABI,
    functionName: "isVerified",
    args: [userAddress as `0x${string}`],
  });

  const reply = evmClient.callContract(runtime, {
    call: {
      to: hexToBase64(registryAddress as `0x${string}`),
      data: hexToBase64(callData),
    },
  }).result();

  const hexData = ("0x" + Buffer.from(reply.data).toString("hex")) as `0x${string}`;
  const [verified] = decodeAbiParameters([{ type: "bool" }], hexData);
  return verified;
}

// ─── Domain Types ─────────────────────────────────────────────────────────────

interface DecryptedOrder {
  id:             string;
  pairId:         string;
  side:           "BUY" | "SELL";
  amount:         string;  // decimal (token units)
  price:          string;  // decimal (USDC per token)
  stealthAddress: string;
  userAddress:    string;
}

interface EncryptedOrderRecord {
  id:               string;
  encryptedPayload: string; // base64
}

interface HTTPResponse {
  statusCode: number;
  body:       string;
}

// ─── Utility helpers ──────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// ─── ECIES Decryption ─────────────────────────────────────────────────────────

function decryptOrder(encryptedBase64: string, privateKeyHex: string): DecryptedOrder {
  const raw = new Uint8Array(Buffer.from(encryptedBase64, "base64"));

  // Layout: compressed_ephemeral_pubkey(33) | iv(12) | aes_gcm_ciphertext_with_tag
  const ephemeralPub = raw.slice(0, 33);
  const iv           = raw.slice(33, 45);
  const ciphertext   = raw.slice(45);

  const sharedPoint = secp256k1.getSharedSecret(hexToBytes(privateKeyHex), ephemeralPub, true);
  const sharedX     = sharedPoint.slice(1); // x-coordinate (32 bytes, drop 0x02/0x03)
  const aesKey      = sha256(sharedX);

  const plaintext = gcm(aesKey, iv).decrypt(ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext)) as DecryptedOrder;
}

// ─── Price-time priority matching ─────────────────────────────────────────────

function findMatch(newOrder: DecryptedOrder, resting: DecryptedOrder[]): DecryptedOrder | null {
  if (newOrder.side === "BUY") {
    // Lowest SELL price that is ≤ our bid
    const candidates = resting
      .filter(o => o.side === "SELL" && parseFloat(o.price) <= parseFloat(newOrder.price))
      .sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
    return candidates[0] ?? null;
  } else {
    // Highest BUY price that is ≥ our ask
    const candidates = resting
      .filter(o => o.side === "BUY" && parseFloat(o.price) >= parseFloat(newOrder.price))
      .sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
    return candidates[0] ?? null;
  }
}

// ─── Synchronous HTTP helper ──────────────────────────────────────────────────

function httpCall(
  sender:   HTTPSendRequester,
  url:      string,
  method:   "GET" | "POST",
  body?:    object,
  headers?: Record<string, string>
): HTTPResponse {
  const bodyStr = body ? JSON.stringify(body) : "";
  const bodyB64 = bodyStr ? Buffer.from(bodyStr).toString("base64") : "";

  const resp = sender.sendRequest({
    url,
    method,
    body: bodyB64,
    headers: { "Content-Type": "application/json", ...headers },
    cacheSettings: { store: false, maxAge: "0s" },
  }).result();

  const bodyOut = resp.body && resp.body.length > 0
    ? new TextDecoder().decode(resp.body)
    : "";

  return { statusCode: resp.statusCode ?? 0, body: bodyOut };
}

// ─── HTTP Trigger Handler ─────────────────────────────────────────────────────

const onHttpTrigger = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
  const input = decodeJson(payload.input) as {
    action:         string;
    encryptedOrder: string; // base64 ECIES ciphertext
    signature:      string; // user ECDSA sig over encrypted payload
    pairId:         string; // unencrypted routing hint
    orderId:        string; // backend-assigned UUID
  };

  if (input.action !== "match_order") {
    return JSON.stringify({ error: "Unknown action: " + input.action });
  }

  runtime.log("[TEE] Received match_order orderId=" + input.orderId);

  // ── 1. Decrypt the incoming order ─────────────────────────────────────────────
  let newOrder: DecryptedOrder;
  try {
    newOrder = decryptOrder(input.encryptedOrder, runtime.config.creDecryptionKey);
    newOrder.id = input.orderId;
  } catch (err) {
    runtime.log("[TEE] Decryption failed: " + err);
    return JSON.stringify({ status: "failed", error: "Decryption failed" });
  }

  runtime.log("[TEE] Decrypted: " + newOrder.side + " " + newOrder.amount + " @ " + newOrder.price);

  // ── 2. Fetch encrypted order book via Confidential HTTP ───────────────────────
  const httpClient = new HTTPClient();

  const bookResult = httpClient.sendRequest(
    runtime,
    (sender: HTTPSendRequester, cfg: Config): HTTPResponse =>
      httpCall(sender, cfg.backendUrl + "/api/order/encrypted-book?pairId=" + newOrder.pairId, "GET"),
    consensusIdenticalAggregation<HTTPResponse>()
  )(runtime.config).result();

  const restingOrders: DecryptedOrder[] = [];
  try {
    const parsed = JSON.parse(bookResult.body) as { orders: EncryptedOrderRecord[] };
    for (const rec of parsed.orders ?? []) {
      if (rec.id === input.orderId || !rec.encryptedPayload) continue;
      try {
        const d = decryptOrder(rec.encryptedPayload, runtime.config.creDecryptionKey);
        d.id = rec.id;
        restingOrders.push(d);
      } catch { /* skip undecryptable */ }
    }
  } catch (err) {
    runtime.log("[TEE] Order book parse error: " + err);
  }

  runtime.log("[TEE] Resting orders: " + restingOrders.length);

  // ── 3. Match inside TEE (invisible to operators) ──────────────────────────────
  const matchedOrder = findMatch(newOrder, restingOrders);

  if (!matchedOrder) {
    runtime.log("[TEE] No match — order pending");
    return JSON.stringify({ status: "pending", orderId: input.orderId });
  }

  runtime.log("[TEE] Match: " + newOrder.id + " <-> " + matchedOrder.id);

  // ── 3b. Verify both parties against WorldIDVerifierRegistry ──────────────────
  // Check the NORMAL (EOA) userAddress — NOT the shield/stealth address.
  const buyerAddr  = (newOrder.side === "BUY"  ? newOrder : matchedOrder).userAddress;
  const sellerAddr = (newOrder.side === "SELL" ? newOrder : matchedOrder).userAddress;

  if (!checkIsVerifiedOnChain(runtime, buyerAddr)) {
    runtime.log("[TEE] Buyer " + buyerAddr + " not World ID verified — aborting match");
    return JSON.stringify({ status: "pending", orderId: input.orderId, reason: "buyer_not_verified" });
  }
  if (!checkIsVerifiedOnChain(runtime, sellerAddr)) {
    runtime.log("[TEE] Seller " + sellerAddr + " not World ID verified — aborting match");
    return JSON.stringify({ status: "pending", orderId: input.orderId, reason: "seller_not_verified" });
  }

  // ── 4. Compute fill amounts ───────────────────────────────────────────────────
  const tradeAmt  = Math.min(parseFloat(newOrder.amount), parseFloat(matchedOrder.amount));
  const execPrice = newOrder.side === "BUY" ? parseFloat(matchedOrder.price) : parseFloat(newOrder.price);
  const quoteAmt  = tradeAmt * execPrice;

  const buyer  = newOrder.side === "BUY"  ? newOrder      : matchedOrder;
  const seller = newOrder.side === "SELL" ? newOrder      : matchedOrder;

  // ── 5. Notify backend → Convergence API settlement ────────────────────────────
  const settleResult = httpClient.sendRequest(
    runtime,
    (sender: HTTPSendRequester, cfg: Config): HTTPResponse =>
      httpCall(
        sender,
        cfg.backendUrl + "/api/order/cre-settle",
        "POST",
        {
          buyerOrderId:         buyer.id,
          sellerOrderId:        seller.id,
          buyerStealthAddress:  buyer.stealthAddress,
          sellerStealthAddress: seller.stealthAddress,
          tradeAmount:          tradeAmt.toString(),
          quoteAmount:          quoteAmt.toFixed(6),
          pairId:               newOrder.pairId,
        },
        { "X-CRE-Secret": cfg.callbackSecret }
      ),
    consensusIdenticalAggregation<HTTPResponse>()
  )(runtime.config).result();

  runtime.log("[TEE] Settle callback HTTP " + settleResult.statusCode);

  let settleData: Record<string, unknown> = {};
  try { settleData = JSON.parse(settleResult.body); } catch { /* ignore */ }

  return JSON.stringify({
    status:        "matched",
    buyerOrderId:  buyer.id,
    sellerOrderId: seller.id,
    tradeAmount:   tradeAmt.toString(),
    quoteAmount:   quoteAmt.toFixed(6),
    ...settleData,
  });
};

// ─── Workflow init ────────────────────────────────────────────────────────────

const initWorkflow = (config: Config) => {
  const httpTrigger = new HTTPCapability();
  return [
    handler(
      httpTrigger.trigger({
        authorizedKeys: [{ type: "KEY_TYPE_ECDSA_EVM", publicKey: config.authorizedEVMAddress }],
      }),
      onHttpTrigger
    ),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
