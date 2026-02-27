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
} from "@chainlink/cre-sdk";
import { keccak256, toBytes, encodeAbiParameters, parseAbiParameters, encodeFunctionData, decodeAbiParameters } from "viem";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

type ChainEntry = {
  chainId: number;
  chainSelector: string;
  ccipChainSelector: string;
  vault: string;
  ccipReceiver: string;
  usdc: string;
  ccipRouter: string;
  forwarder: string;
  /** WorldIDVerifierRegistry address — when set, verify reports go here instead of vault */
  worldIdRegistry?: string;
};

type Config = {
  authorizedEVMAddress: string;
  gasLimit: string;
  worldIdVerifyUrl: string;
  worldIdAction: string;
  primaryChain: string;
  chains: Record<string, ChainEntry>;
};

interface VerifyPayload {
  action: "verify";
  nullifier_hash: string;
  proof: string;
  merkle_root: string;
  verification_level: string;
  signal?: string;
  userAddress: string;
  selectedChains?: string[];
}

function hashToField(input: string): string {
  const hash = BigInt(keccak256(toBytes(input))) >> 8n;
  return `0x${hash.toString(16).padStart(64, "0")}`;
}

type VerificationResponse = {
  statusCode: number;
  body: string;
};

// ──────────────────────────────────────────────
// Report helper
// ──────────────────────────────────────────────

function sendReportToChain(
  runtime: Runtime<Config>,
  reportData: `0x${string}`,
  chainSelectorName: string,
  vaultAddress: string
) {
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName,
    isTestnet: true,
  });

  if (!network) {
    throw new Error("Network not found: " + chainSelectorName);
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
      receiver: vaultAddress,
      report: reportResponse,
      gasConfig: { gasLimit: runtime.config.gasLimit },
    })
    .result();

  if (writeResult.txStatus !== TxStatus.SUCCESS) {
    throw new Error("Report tx failed on " + chainSelectorName + ": " + writeResult.txStatus);
  }

  return bytesToHex(writeResult.txHash || new Uint8Array(32));
}

// ──────────────────────────────────────────────
// On-chain isVerified check
// ──────────────────────────────────────────────

const IS_VERIFIED_ABI = [{
  name: "isVerified",
  type: "function",
  inputs: [{ name: "", type: "address" }],
  outputs: [{ name: "", type: "bool" }],
  stateMutability: "view",
}] as const;

function checkIsVerified(runtime: Runtime<Config>, chainCfg: ChainEntry, userAddress: string): boolean {
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: chainCfg.chainSelector,
    isTestnet: true,
  });

  if (!network) {
    runtime.log("Network not found for isVerified check on " + chainCfg.chainSelector + ", assuming not verified");
    return false;
  }

  const evmClient = new EVMClient(network.chainSelector.selector);

  const callData = encodeFunctionData({
    abi: IS_VERIFIED_ABI,
    functionName: "isVerified",
    args: [userAddress as `0x${string}`],
  });

  // Read from WorldIDVerifierRegistry if configured, fall back to vault (legacy)
  const registryTarget = (chainCfg.worldIdRegistry || chainCfg.vault) as `0x${string}`;

  const reply = evmClient.callContract(runtime, {
    call: {
      to: hexToBase64(registryTarget),
      data: hexToBase64(callData),
    },
  }).result();

  const hexData = ("0x" + Buffer.from(reply.data).toString("hex")) as `0x${string}`;
  const [verified] = decodeAbiParameters([{ type: "bool" }], hexData);
  return verified;
}

// ──────────────────────────────────────────────
// Verification helper
// ──────────────────────────────────────────────

const verifyProof = (sendRequester: HTTPSendRequester, config: Config, data: VerifyPayload): VerificationResponse => {
  const bodyData: Record<string, string> = {
    nullifier_hash: data.nullifier_hash,
    merkle_root: data.merkle_root,
    proof: data.proof,
    verification_level: data.verification_level,
    action: config.worldIdAction,
    signal_hash: hashToField(data.signal ?? ""),
  };

  const bodyBytes = new TextEncoder().encode(JSON.stringify(bodyData));
  const body = Buffer.from(bodyBytes).toString("base64");

  const resp = sendRequester.sendRequest({
    url: config.worldIdVerifyUrl,
    method: "POST" as const,
    body,
    headers: { "Content-Type": "application/json" },
    cacheSettings: { store: true, maxAge: "60s" },
  }).result();

  let responseBody = "";
  if (resp.body && resp.body.length > 0) {
    try {
      responseBody = new TextDecoder().decode(resp.body);
    } catch {
      // ignore decode failures
    }
  }

  return { statusCode: resp.statusCode ?? 0, body: responseBody };
};

// ──────────────────────────────────────────────
// HTTP trigger handler
// ──────────────────────────────────────────────

const onHttpTrigger = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
  const data = decodeJson(payload.input) as VerifyPayload;

  if (data.action !== "verify") {
    return JSON.stringify({ error: "Unknown action: " + data.action });
  }

  runtime.log("Verify request for nullifier: " + data.nullifier_hash + ", address: " + data.userAddress);

  const httpClient = new HTTPClient();
  const verificationResult = httpClient
    .sendRequest(
      runtime,
      (sender, cfg: Config) => verifyProof(sender, cfg, data),
      consensusIdenticalAggregation<VerificationResponse>()
    )(runtime.config)
    .result();

  if (verificationResult.statusCode < 200 || verificationResult.statusCode >= 300) {
    const verificationBody = verificationResult.body || "";
    const compactBody = verificationBody.replace(/\s+/g, " ").trim();
    const alreadyUsed =
      verificationBody.includes("max_verifications_reached") ||
      verificationBody.includes("already_verified") ||
      verificationBody.includes("exceeded_max_verifications");

    if (!alreadyUsed) {
      runtime.log("Verification failed: status=" + verificationResult.statusCode + " body=" + compactBody);

      let worldErrorCode = "unknown";
      try {
        const parsed = JSON.parse(verificationBody);
        if (parsed && typeof parsed.code === "string") {
          worldErrorCode = parsed.code;
        } else if (parsed && typeof parsed.error === "string") {
          worldErrorCode = parsed.error;
        }
      } catch {
        // Body is not JSON; keep code as "unknown"
      }
      return JSON.stringify({
        status: "failed",
        error: "Verification failed with status " + verificationResult.statusCode + " body: " + compactBody,
        worldErrorCode,
        worldResponseBody: compactBody,
      });
    }

    runtime.log("World ID reports already verified/max verifications — proceeding with on-chain report");
  }

  const reportData = encodeAbiParameters(
    parseAbiParameters("uint8 reportType, address user"),
    [0, data.userAddress as `0x${string}`]
  );

  const allChains = Object.entries(runtime.config.chains);
  const targetChains = data.selectedChains && data.selectedChains.length > 0
    ? allChains.filter(([chainName]) => data.selectedChains!.includes(chainName))
    : allChains;

  if (targetChains.length === 0) {
    runtime.log("No matching chains found for selectedChains: " + JSON.stringify(data.selectedChains));
  }

  const chainResults: Record<string, string> = {};
  for (const [chainName, chainCfg] of targetChains) {
    if (!chainCfg.vault) {
      runtime.log(`No vault deployed on ${chainName}, skipping`);
      chainResults[chainName] = "no_vault";
      continue;
    }

    let alreadyVerified = false;
    try {
      alreadyVerified = checkIsVerified(runtime, chainCfg, data.userAddress);
    } catch (err: any) {
      runtime.log(`isVerified check FAILED on ${chainName}: ${err.message} — proceeding with report`);
    }

    if (alreadyVerified) {
      runtime.log(`User already verified on ${chainName}, skipping`);
      chainResults[chainName] = "already_verified";
      continue;
    }

    const reportTarget = chainCfg.worldIdRegistry || chainCfg.vault;
    try {
      const txHash = sendReportToChain(runtime, reportData, chainCfg.chainSelector, reportTarget);
      chainResults[chainName] = txHash;
      runtime.log(`Verify tx on ${chainName} → ${reportTarget}: ${txHash}`);
    } catch (err: any) {
      runtime.log(`Verify tx FAILED on ${chainName}: ${err.message}`);
      chainResults[chainName] = "FAILED: " + (err.message || "unknown");
    }
  }

  return JSON.stringify({
    status: "verified",
    nullifier_hash: data.nullifier_hash,
    userAddress: data.userAddress,
    chains: chainResults,
  });
};

// ──────────────────────────────────────────────
// Init workflow
// ──────────────────────────────────────────────

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
