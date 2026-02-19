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

type ChainEntry = {
  chainId: number;
  chainSelector: string;
  ccipChainSelector: string;
  vault: string;
  ccipReceiver: string;
  usdc: string;
  ccipRouter: string;
  forwarder: string;
};

type Config = {
  authorizedEVMAddress: string;
  gasLimit: string;
  worldIdVerifyUrl: string;
  worldIdAction: string;
  primaryChain: string;
  chains: Record<string, ChainEntry>;
};

function getPrimaryChain(config: Config): ChainEntry {
  return config.chains[config.primaryChain];
}

function findChainBySelector(config: Config, selectorName: string): ChainEntry | undefined {
  return Object.values(config.chains).find(c => c.chainSelector === selectorName);
}

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
  crossChain?: boolean;
  sourceChainSelector?: string;
  destChainSelector?: string;
  ccipDestSelector?: string;
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

function sendReport(runtime: Runtime<Config>, reportData: `0x${string}`) {
  const primary = getPrimaryChain(runtime.config);
  return sendReportToChain(
    runtime,
    reportData,
    primary.chainSelector,
    primary.vault
  );
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
    action: config.worldIdAction,
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

    const buyerStealthAddr = data.buyer.stealthAddress;
    const sellerStealthAddr = data.seller.stealthAddress;

    runtime.log("Stealth buyer: " + buyerStealthAddr);
    runtime.log("Stealth seller: " + sellerStealthAddr);

    const orderId = keccak256(
      encodePacked(
        ["string", "string", "string", "string"],
        [data.buyer.orderId, data.seller.orderId, buyerStealthAddr, sellerStealthAddr]
      )
    );

    // ── Cross-chain settlement ──
    if (data.crossChain && data.ccipDestSelector && data.destChainSelector) {
      runtime.log("Cross-chain settlement detected");

      const primary = getPrimaryChain(runtime.config);
      const sourceChain = data.sourceChainSelector || primary.chainSelector;
      const destChain = data.destChainSelector;

      const sourceCfg = findChainBySelector(runtime.config, sourceChain);
      const destCfg = findChainBySelector(runtime.config, destChain);

      if (!sourceCfg || !sourceCfg.vault) throw new Error("Source chain not configured: " + sourceChain);
      if (!destCfg || !destCfg.ccipReceiver) throw new Error("Dest chain ccipReceiver not configured: " + destChain);

      const sourceVault = sourceCfg.vault;
      const destReceiver = destCfg.ccipReceiver;

      const ccipDestSelectorBigInt = BigInt(data.ccipDestSelector);

      // crossChainSettle (type=3) on SOURCE vault
      // Source vault bridges USDC via CCIP to dest chain's SSLCCIPReceiver
      // Receiver forwards tokens to recipient and calls vault.markSettled()
      const bridgeReport = encodeAbiParameters(
        parseAbiParameters(
          "uint8 reportType, bytes32 orderId, uint64 destChainSelector, address destReceiver, address recipient, address token, uint256 amount"
        ),
        [
          3,
          orderId as `0x${string}`,
          ccipDestSelectorBigInt,
          destReceiver as `0x${string}`,
          sellerStealthAddr as `0x${string}`,
          data.quoteTokenAddress as `0x${string}`,
          tradeAmount,
        ]
      );

      runtime.log("Sending crossChainSettle (type=3) to " + sourceChain + " vault " + sourceVault);
      const bridgeTxHash = sendReportToChain(runtime, bridgeReport, sourceChain, sourceVault);
      runtime.log("Bridge tx: " + bridgeTxHash);

      return JSON.stringify({
        status: "settled_cross_chain",
        orderId,
        stealthBuyer: buyerStealthAddr,
        stealthSeller: sellerStealthAddr,
        bridgeTxHash,
      });
    }

    // ── Same-chain settlement (type=1) ──
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
