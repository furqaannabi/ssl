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

import { encodeFunctionData, decodeAbiParameters, hashTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { secp256k1 } from "@noble/curves/secp256k1";
import { gcm } from "@noble/ciphers/aes";
import { sha256 } from "@noble/hashes/sha256";

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
  /** WorldIDVerifierRegistry address on ETH Sepolia. */
  worldIdRegistry?: string;
  /** ETH Sepolia chain selector name */
  ethSepoliaChainSelector?: string;
  /** Convergence API Domain URL */
  convergenceApiUrl: string;
  /** EOA Private Key (hex without 0x or with 0x) used for signing the EIP-712 payloads. */
  servicePrivateKey: string;
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
  id: string;
  pairId: string;
  side: "BUY" | "SELL";
  amount: string;  // decimal (token units)
  price: string;  // decimal (USDC per token)
  shieldAddress: string;
  userAddress: string;
}

interface EncryptedOrderRecord {
  id: string;
  encryptedPayload: string; // base64
}

interface HTTPResponse {
  statusCode: number;
  body: string;
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

// ─── EIP-712 Convergence Signer ───────────────────────────────────────────────

const CONVERGENCE_DOMAIN = {
  name:              "CompliantPrivateTokenDemo",
  version:           "0.0.1",
  chainId:           11155111,
  verifyingContract: "0xE588a6c73933BFD66Af9b4A07d48bcE59c0D2d13",
} as const;

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

function getServiceAddress(runtime: Runtime<Config>): string {
  const key = runtime.config.servicePrivateKey.startsWith("0x")
    ? runtime.config.servicePrivateKey as `0x${string}`
    : `0x${runtime.config.servicePrivateKey}` as `0x${string}`;
  return privateKeyToAccount(key).address;
}

function signTransfer(runtime: Runtime<Config>, params: {
  sender:    string;
  recipient: string;
  token:     string;
  amount:    string;  // wei string
  flags:     string[];
  timestamp: number;
}): string {
  const hash = hashTypedData({
    domain:      CONVERGENCE_DOMAIN,
    types:       TRANSFER_TYPES,
    primaryType: "Private Token Transfer",
    message: {
      sender:    params.sender    as `0x${string}`,
      recipient: params.recipient as `0x${string}`,
      token:     params.token     as `0x${string}`,
      amount:    BigInt(params.amount),
      flags:     params.flags,
      timestamp: BigInt(params.timestamp),
    },
  });
  const privKeyHex = runtime.config.servicePrivateKey.startsWith("0x")
    ? runtime.config.servicePrivateKey.slice(2)
    : runtime.config.servicePrivateKey;
  const sig = secp256k1.sign(hexToBytes(hash), privKeyHex);
  const r = sig.r.toString(16).padStart(64, "0");
  const s = sig.s.toString(16).padStart(64, "0");
  const v = (sig.recovery + 27).toString(16).padStart(2, "0");
  return `0x${r}${s}${v}`;
}

// Convert decimal amount to wei string using integer math (no floating-point rounding)
function toWeiStr(decimalAmt: number, decimals: number): string {
  const str = decimalAmt.toFixed(decimals);
  const [int, frac = ""] = str.split(".");
  return int + frac.padEnd(decimals, "0");
}

// ─── ECIES Decryption ─────────────────────────────────────────────────────────

function decryptOrder(encryptedBase64: string, privateKeyHex: string): DecryptedOrder {
  const raw = new Uint8Array(Buffer.from(encryptedBase64, "base64"));

  // Layout: compressed_ephemeral_pubkey(33) | iv(12) | aes_gcm_ciphertext_with_tag
  const ephemeralPub = raw.slice(0, 33);
  const iv = raw.slice(33, 45);
  const ciphertext = raw.slice(45);

  const sharedPoint = secp256k1.getSharedSecret(hexToBytes(privateKeyHex), ephemeralPub, true);
  const sharedX = sharedPoint.slice(1); // x-coordinate (32 bytes, drop 0x02/0x03)
  const aesKey = sha256(sharedX);

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
  sender: HTTPSendRequester,
  url: string,
  method: "GET" | "POST",
  body?: object,
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
    encryptedOrder: string;
    signature:      string;
    pairId:         string;
    orderId:        string;
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
  const buyerAddr = (newOrder.side === "BUY" ? newOrder : matchedOrder).userAddress;
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
  const tradeAmt = Math.min(parseFloat(newOrder.amount), parseFloat(matchedOrder.amount));
  const execPrice = newOrder.side === "BUY" ? parseFloat(matchedOrder.price) : parseFloat(newOrder.price);
  const quoteAmt = tradeAmt * execPrice;

  const buyer = newOrder.side === "BUY" ? newOrder : matchedOrder;
  const seller = newOrder.side === "SELL" ? newOrder : matchedOrder;

  // ── 4b. Single call: fetch shield addresses + token metadata (saves HTTP quota) ──
  const isValidAddress = (a: unknown): a is string =>
    typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);

  const settleInfoRes = httpClient.sendRequest(
    runtime,
    (sender: HTTPSendRequester, cfg: Config): HTTPResponse =>
      httpCall(
        sender,
        cfg.backendUrl + "/api/order/settle-info?buyerOrderId=" + buyer.id +
          "&sellerOrderId=" + seller.id + "&pairId=" + input.pairId,
        "GET",
        undefined,
        { "X-CRE-Secret": cfg.callbackSecret }
      ),
    consensusIdenticalAggregation<HTTPResponse>()
  )(runtime.config).result();

  let buyerShieldAddress  = "";
  let sellerShieldAddress = "";
  let baseTokenAddress    = "";
  let quoteTokenAddress   = "";
  let baseDecimals        = 18;
  let quoteDecimals       = 6;

  try {
    const info = JSON.parse(settleInfoRes.body) as {
      buyerShieldAddress:  string;
      sellerShieldAddress: string;
      baseTokenAddress:    string;
      quoteTokenAddress:   string;
      baseDecimals:        number;
      quoteDecimals:       number;
    };
    buyerShieldAddress  = info.buyerShieldAddress  ?? "";
    sellerShieldAddress = info.sellerShieldAddress ?? "";
    baseTokenAddress    = info.baseTokenAddress    ?? "";
    quoteTokenAddress   = info.quoteTokenAddress   ?? "";
    baseDecimals        = info.baseDecimals        ?? 18;
    quoteDecimals       = info.quoteDecimals       ?? 6;
  } catch (e) {
    runtime.log("[TEE] Failed to parse settle-info: " + e);
    return JSON.stringify({ status: "pending", orderId: input.orderId, reason: "settle_info_fetch_failed" });
  }

  runtime.log("[TEE] Shields — buyer=" + buyerShieldAddress + " seller=" + sellerShieldAddress);

  if (!isValidAddress(buyerShieldAddress) || !isValidAddress(sellerShieldAddress)) {
    runtime.log("[TEE] Missing shield address — skipping match");
    return JSON.stringify({ status: "pending", orderId: input.orderId, reason: "missing_shield_address" });
  }
  if (!baseTokenAddress || !quoteTokenAddress) {
    runtime.log("[TEE] Token addresses missing");
    return JSON.stringify({ status: "pending", orderId: input.orderId, reason: "token_meta_missing" });
  }

  // ── 5. Execute Convergence private transfers inside TEE ───────────────────────
  const serviceAccount = getServiceAddress(runtime);
  const timestamp      = Math.floor(Date.now() / 1000);

  const baseAmountWei  = toWeiStr(tradeAmt, baseDecimals);
  const quoteAmountWei = toWeiStr(quoteAmt, quoteDecimals);

  runtime.log("[TEE] Settling: " + baseAmountWei + " base -> buyer, " + quoteAmountWei + " quote -> seller");

  // Base token (RWA) → buyer's shield address
  const buyerAuth = signTransfer(runtime, {
    sender: serviceAccount, recipient: buyerShieldAddress,
    token: baseTokenAddress, amount: baseAmountWei,
    flags: ["hide-sender"], timestamp,
  });
  const buyerTxRes = httpClient.sendRequest(
    runtime,
    (sender: HTTPSendRequester, cfg: Config): HTTPResponse =>
      httpCall(sender, cfg.convergenceApiUrl + "/private-transfer", "POST", {
        account: serviceAccount, recipient: buyerShieldAddress,
        token: baseTokenAddress, amount: baseAmountWei,
        flags: ["hide-sender"], timestamp, auth: buyerAuth,
      }),
    consensusIdenticalAggregation<HTTPResponse>()
  )(runtime.config).result();
  runtime.log("[TEE] BuyerTx HTTP " + buyerTxRes.statusCode + " — " + buyerTxRes.body);
  let buyerTxId: string | null = null;
  try { buyerTxId = (JSON.parse(buyerTxRes.body) as any).transaction_id ?? null; } catch { }

  // Quote token (USDC) → seller's shield address
  const sellerAuth = signTransfer(runtime, {
    sender: serviceAccount, recipient: sellerShieldAddress,
    token: quoteTokenAddress, amount: quoteAmountWei,
    flags: ["hide-sender"], timestamp: timestamp + 1, // +1 to avoid nonce collision
  });
  const sellerTxRes = httpClient.sendRequest(
    runtime,
    (sender: HTTPSendRequester, cfg: Config): HTTPResponse =>
      httpCall(sender, cfg.convergenceApiUrl + "/private-transfer", "POST", {
        account: serviceAccount, recipient: sellerShieldAddress,
        token: quoteTokenAddress, amount: quoteAmountWei,
        flags: ["hide-sender"], timestamp: timestamp + 1, auth: sellerAuth,
      }),
    consensusIdenticalAggregation<HTTPResponse>()
  )(runtime.config).result();
  runtime.log("[TEE] SellerTx HTTP " + sellerTxRes.statusCode + " — " + sellerTxRes.body);
  let sellerTxId: string | null = null;
  try { sellerTxId = (JSON.parse(sellerTxRes.body) as any).transaction_id ?? null; } catch { }

  // ── 6. Notify backend to update DB status only ───────────────────────────────
  const settleResult = httpClient.sendRequest(
    runtime,
    (sender: HTTPSendRequester, cfg: Config): HTTPResponse =>
      httpCall(
        sender,
        cfg.backendUrl + "/api/order/cre-settle",
        "POST",
        {
          buyerOrderId:  buyer.id,
          sellerOrderId: seller.id,
          tradeAmount:   tradeAmt.toString(),
          quoteAmount:   quoteAmt.toFixed(6),
          pairId:        input.pairId,
          buyerTxId,
          sellerTxId,
        },
        { "X-CRE-Secret": cfg.callbackSecret }
      ),
    consensusIdenticalAggregation<HTTPResponse>()
  )(runtime.config).result();

  runtime.log("[TEE] DB update HTTP " + settleResult.statusCode);

  return JSON.stringify({
    status:        "matched",
    buyerOrderId:  buyer.id,
    sellerOrderId: seller.id,
    tradeAmount:   tradeAmt.toString(),
    quoteAmount:   quoteAmt.toFixed(6),
    buyerTxId,
    sellerTxId,
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
