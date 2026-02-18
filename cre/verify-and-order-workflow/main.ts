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
import { keccak256, encodePacked, encodeAbiParameters, parseAbiParameters } from "viem";

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
  baseTokenAddress: string;
  quoteTokenAddress: string;
  tradeAmount: string;
  buyer: {
    orderId: string;
    stealthAddress: string;
  };
  seller: {
    orderId: string;
    stealthAddress: string;
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

    // Report (type=0, address)
    const reportData = encodeAbiParameters(
      parseAbiParameters("uint8 reportType, address user"),
      [0, data.userAddress as `0x${string}`]
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

    const tradeAmount = BigInt(data.tradeAmount);
    runtime.log("Trade amount: " + tradeAmount.toString());

    // Stealth addresses provided by the frontend (generated client-side)
    const buyerStealthAddr = data.buyer.stealthAddress;
    const sellerStealthAddr = data.seller.stealthAddress;

    runtime.log("Stealth buyer: " + buyerStealthAddr);
    runtime.log("Stealth seller: " + sellerStealthAddr);

    // Deterministic order ID from order IDs + stealth addresses
    const orderId = keccak256(
      encodePacked(
        ["string", "string", "string", "string"],
        [data.buyer.orderId, data.seller.orderId, buyerStealthAddr, sellerStealthAddr]
      )
    );

    const reportData = encodeAbiParameters(
      parseAbiParameters(
        "uint8 reportType, bytes32 orderId, address stealthBuyer, address stealthSeller, address tokenA, address tokenB, uint256 amountA, uint256 amountB"
      ),
      [
        1,
        orderId as `0x${string}`,
        buyerStealthAddr as `0x${string}`,
        sellerStealthAddr as `0x${string}`,
        data.baseTokenAddress as `0x${string}`,
        data.quoteTokenAddress as `0x${string}`,
        tradeAmount,
        tradeAmount,
      ]
    );

    const txHash = sendReport(runtime, reportData);
    runtime.log("Settlement tx: " + txHash);

    return JSON.stringify({
      status: "settled",
      orderId,
      stealthBuyer: buyerStealthAddr,
      stealthSeller: sellerStealthAddr,
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
