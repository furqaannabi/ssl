import {
  HTTPCapability,
  handler,
  Runner,
  type Runtime,
  type HTTPPayload,
  decodeJson,
  EVMClient,
  getNetwork,
  hexToBase64,
  bytesToHex,
  TxStatus,
  HTTPClient,
  HTTPSendRequester,
  consensusIdenticalAggregation,
  ok,
} from "@chainlink/cre-sdk";
import { keccak256, encodePacked, encodeAbiParameters, parseAbiParameters, toBytes, toHex } from "viem";
import { secp256k1 } from "@noble/curves/secp256k1.js";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type Config = {
  vaultAddress: string;
  chainSelectorName: string;
  authorizedEVMAddress: string;
  gasLimit: string;
  worldIdVerifyUrl: string;
  worldIdAction: string;
};

interface VerifyPayload {
  action: "verify";
  nullifierHash: string;
  proof: string;
  merkle_root: string;
  credential_type: string;
  verification_level: string;
  signal: string;
  userAddress: string;
}

type VerificationResponse = {
  statusCode: number;
  body: any;
};

interface MatchPayload {
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

interface WithdrawPayload {
  action: "withdraw";
  withdrawalId: string;
  userAddress: string;
  amount: string;
  token: string;
}

type Payload = VerifyPayload | MatchPayload | WithdrawPayload;

interface Order {
  nullifierHash: string;
  order: {
    asset: string;
    quoteToken: string;
    amount: string;
    price: string;
    side: "BUY" | "SELL";
  };
  stealthPublicKey: string;
}

interface StealthResult {
  stealthAddress: string;
  ephemeralPublicKey: string;
}

// ──────────────────────────────────────────────
// State
// ──────────────────────────────────────────────



// ──────────────────────────────────────────────
// ECDH Stealth Address (EIP-5564 style)
// ──────────────────────────────────────────────

function generateStealthAddress(
  spendingPublicKeyHex: string,
  ephemeralSeed: string
): StealthResult {
  // Deterministic ephemeral private key from seed (avoids needing crypto.getRandomValues in WASM)
  const ephemeralPrivBytes = toBytes(keccak256(toBytes(ephemeralSeed)));
  const ephemeralPublicKey = secp256k1.getPublicKey(ephemeralPrivBytes, false); // uncompressed 65 bytes

  // ECDH: shared secret = ephemeralPrivate * spendingPublic
  const spendingPubBytes = hexToUint8Array(spendingPublicKeyHex);
  const sharedPoint = secp256k1.getSharedSecret(ephemeralPrivBytes, spendingPubBytes);
  const sharedHash = keccak256(toHex(sharedPoint));

  // Stealth public key = S + hash(sharedSecret) * G
  const S = secp256k1.Point.fromBytes(spendingPubBytes);
  const hashScalar = BigInt(sharedHash);
  const offsetPoint = secp256k1.Point.BASE.multiply(hashScalar);
  const stealthPoint = S.add(offsetPoint);
  const stealthPubBytes = stealthPoint.toBytes(false); // uncompressed 65 bytes

  // Address = last 20 bytes of keccak256(pubkey without 0x04 prefix)
  const pubKeyWithoutPrefix = stealthPubBytes.slice(1);
  const addressHash = keccak256(toHex(pubKeyWithoutPrefix));
  const stealthAddress = "0x" + addressHash.slice(-40);

  return {
    stealthAddress,
    ephemeralPublicKey: toHex(ephemeralPublicKey),
  };
}

function hexToUint8Array(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// ──────────────────────────────────────────────
// Matching engine
// ──────────────────────────────────────────────



// ──────────────────────────────────────────────
// Report helpers
// ──────────────────────────────────────────────

function sendReport(runtime: Runtime<Config>, reportData: `0x${string}`) {
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.chainSelectorName,
    isTestnet: true,
  });

  if (!network) {
    throw new Error("Network not found: " + runtime.config.chainSelectorName);
  }

  const evmClient = new EVMClient(network.chainSelector.selector);

  const reportResponse = runtime
    .report({
      encodedPayload: hexToBase64(reportData),
      encoderName: "evm",
      signingAlgo: "ecdsa",
      hashingAlgo: "keccak256",
    })
    .result();

  const writeResult = evmClient
    .writeReport(runtime, {
      receiver: runtime.config.vaultAddress,
      report: reportResponse,
      gasConfig: { gasLimit: runtime.config.gasLimit },
    })
    .result();

  if (writeResult.txStatus !== TxStatus.SUCCESS) {
    throw new Error("Report tx failed: " + writeResult.txStatus);
  }

  return bytesToHex(writeResult.txHash || new Uint8Array(32));

}

// ──────────────────────────────────────────────
// Verification helper
// ──────────────────────────────────────────────

const verifyProof = (sendRequester: HTTPSendRequester, config: Config, data: VerifyPayload): VerificationResponse => {
  const bodyData = {
    nullifier_hash: data.nullifierHash,
    merkle_root: data.merkle_root,
    proof: data.proof,
    credential_type: data.credential_type,
    verification_level: data.verification_level,
    action: config.worldIdAction, // Assuming 'verify' action maps to World ID action, or generic 'verify'. 
    // If 'action' in payload is distinct from World ID 'action', we might need adjustment.
    // For now assuming the payload contains the necessary World ID fields.
    signal: data.signal,
  };

  const bodyBytes = new TextEncoder().encode(JSON.stringify(bodyData));
  const body = Buffer.from(bodyBytes).toString("base64");

  const req = {
    url: config.worldIdVerifyUrl,
    method: "POST" as const,
    body,
    headers: {
      "Content-Type": "application/json",
    },
    cacheSettings: {
      store: true,
      maxAge: "60s",
    },
  };

  const resp = sendRequester.sendRequest(req).result();

  let decodedBody = {};
  if (resp.body) {
    try {
      const jsonString = new TextDecoder().decode(resp.body);
      decodedBody = JSON.parse(jsonString);
    } catch (e) {
      // ignore
    }
  }

  return { statusCode: resp.statusCode, body: decodedBody };
};

// ──────────────────────────────────────────────
// HTTP trigger handler
// ──────────────────────────────────────────────

const onHttpTrigger = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
  const data = decodeJson(payload.input) as Payload;

  // ── Action: verify ──

  if (data.action === "verify") {
    runtime.log("Verify request for nullifier: " + data.nullifierHash + ", address: " + data.userAddress);

    // Call Verification (Single Execution)
    const httpClient = new HTTPClient();
    const verificationResult = httpClient
      .sendRequest(
        runtime,
        (sender, cfg: Config) => verifyProof(sender, cfg, data),
        consensusIdenticalAggregation<VerificationResponse>()
      )(runtime.config)
      .result();

    if (verificationResult.statusCode < 200 || verificationResult.statusCode >= 300) {
      runtime.log("Verification failed: " + verificationResult.statusCode);
      return JSON.stringify({
        status: "failed",
        error: "Verification failed with status " + verificationResult.statusCode
      });
    }

    runtime.log("Proof Verified. Proceeding to on-chain report for address: " + data.userAddress);

    // Report (type=0, address, nullifierHash)
    const reportData = encodeAbiParameters(
      parseAbiParameters("uint8 reportType, address user, uint256 nullifierHash"),
      [0, data.userAddress as `0x${string}`, BigInt(data.nullifierHash)]
    );

    const txHash = sendReport(runtime, reportData);
    runtime.log("Verify tx: " + txHash);

    return JSON.stringify({
      status: "verified",
      nullifierHash: data.nullifierHash,
      userAddress: data.userAddress,
      txHash,
    });
  }

  // ── Action: settle_match ──
  if (data.action === "settle_match") {
    runtime.log("Settlement request for " + data.buyer.orderId + " <-> " + data.seller.orderId);

    // Compute trade amount
    const amountBuy = BigInt(data.buyer.order.amount);
    const amountSell = BigInt(data.seller.order.amount);
    const tradeAmount = amountBuy < amountSell ? amountBuy : amountSell;

    // Deterministic trade nonce from order IDs
    const tradeNonce = keccak256(
      encodePacked(
        ["string", "string"],
        [data.buyer.orderId, data.seller.orderId]
      )
    );

    // Generate ECDH stealth addresses
    // data.buyer.stealthPublicKey is usually hex string
    const buyerStealth = generateStealthAddress(
      data.buyer.stealthPublicKey,
      tradeNonce + "_buyer"
    );
    const sellerStealth = generateStealthAddress(
      data.seller.stealthPublicKey,
      tradeNonce + "_seller"
    );

    runtime.log("Stealth buyer: " + buyerStealth.stealthAddress);
    runtime.log("Stealth seller: " + sellerStealth.stealthAddress);

    const orderId = keccak256(
      encodePacked(
        ["string", "string", "string"],
        [tradeNonce, buyerStealth.stealthAddress, sellerStealth.stealthAddress]
      )
    );

    // Encode settle report
    const reportData = encodeAbiParameters(
      parseAbiParameters(
        "uint8 reportType, bytes32 orderId, address stealthBuyer, address stealthSeller, address tokenA, address tokenB, uint256 amountA, uint256 amountB"
      ),
      [
        1,
        orderId as `0x${string}`,
        buyerStealth.stealthAddress as `0x${string}`,
        sellerStealth.stealthAddress as `0x${string}`,
        data.seller.order.asset as `0x${string}`,
        data.seller.order.quoteToken as `0x${string}`,
        tradeAmount,
        tradeAmount,
      ]
    );

    const txHash = sendReport(runtime, reportData);
    runtime.log("Settlement tx: " + txHash);

    return JSON.stringify({
      status: "settled",
      orderId,
      stealthBuyer: buyerStealth.stealthAddress,
      stealthSeller: sellerStealth.stealthAddress,
      txHash,
    });
  }



  // ── Action: withdraw ──
  if (data.action === "withdraw") {
    runtime.log("Withdrawal request " + data.withdrawalId + " for " + data.userAddress);

    // Report (type=2, user, withdrawalId)
    const reportData = encodeAbiParameters(
      parseAbiParameters("uint8 reportType, address user, uint256 withdrawalId"),
      [2, data.userAddress as `0x${string}`, BigInt(data.withdrawalId)]
    );

    const txHash = sendReport(runtime, reportData);
    runtime.log("Withdrawal tx: " + txHash);

    return JSON.stringify({
      status: "withdrawn",
      withdrawalId: data.withdrawalId,
      userAddress: data.userAddress,
      txHash,
    });
  }

  return JSON.stringify({ error: "Unknown action" });
};

// ──────────────────────────────────────────────
// Init workflow
// ──────────────────────────────────────────────

const initWorkflow = (config: Config) => {
  const httpTrigger = new HTTPCapability();
  return [
    handler(
      httpTrigger.trigger({
        authorizedKeys: [
          {
            type: "KEY_TYPE_ECDSA_EVM",
            publicKey: config.authorizedEVMAddress,
          },
        ],
      }),
      onHttpTrigger
    ),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
