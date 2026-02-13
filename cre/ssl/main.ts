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
};

interface VerifyPayload {
  action: "verify";
  nullifierHash: string;
}

interface OrderPayload {
  action: "order";
  nullifierHash: string;
  asset: string;
  quoteToken: string;
  amount: string;
  price: string;
  side: "BUY" | "SELL";
  stealthPublicKey: string;
}

type Payload = VerifyPayload | OrderPayload;

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

// ──────────────────────────────────────────────
// State
// ──────────────────────────────────────────────

const buyOrders: Order[] = [];
const sellOrders: Order[] = [];

// ──────────────────────────────────────────────
// Stealth address generation
// ──────────────────────────────────────────────

function generateStealthAddress(stealthPublicKey: string, tradeNonce: string): string {
  const hash = keccak256(
    encodePacked(["string", "string"], [stealthPublicKey, tradeNonce])
  );
  return ("0x" + hash.slice(26)) as string;
}

// ──────────────────────────────────────────────
// Matching engine
// ──────────────────────────────────────────────

function storeOrder(order: Order) {
  if (order.order.side === "BUY") buyOrders.push(order);
  else sellOrders.push(order);
}

function matchOrders(): { buyer: Order; seller: Order } | null {
  for (let i = 0; i < buyOrders.length; i++) {
    for (let j = 0; j < sellOrders.length; j++) {
      const buy = buyOrders[i];
      const sell = sellOrders[j];
      if (
        buy.order.asset === sell.order.asset &&
        BigInt(buy.order.price) >= BigInt(sell.order.price)
      ) {
        buyOrders.splice(i, 1);
        sellOrders.splice(j, 1);
        return { buyer: buy, seller: sell };
      }
    }
  }
  return null;
}

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
// HTTP trigger handler
// ──────────────────────────────────────────────

const onHttpTrigger = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
  const data = decodeJson(payload.input) as Payload;

  // ── Action: verify ──
  if (data.action === "verify") {
    runtime.log("Verify request for nullifier: " + data.nullifierHash);

    // Encode verify report: type=0, nullifierHash
    const reportData = encodeAbiParameters(
      parseAbiParameters("uint8 reportType, uint256 nullifierHash"),
      [0, BigInt(data.nullifierHash)]
    );

    const txHash = sendReport(runtime, reportData);
    runtime.log("Verify tx: " + txHash);

    return JSON.stringify({
      status: "verified",
      nullifierHash: data.nullifierHash,
      txHash,
    });
  }

  // ── Action: order ──
  runtime.log("Order received: " + data.side + " " + data.amount + " @ " + data.price);

  // Store order
  const order: Order = {
    nullifierHash: data.nullifierHash,
    order: {
      asset: data.asset,
      quoteToken: data.quoteToken,
      amount: data.amount,
      price: data.price,
      side: data.side,
    },
    stealthPublicKey: data.stealthPublicKey,
  };

  storeOrder(order);
  runtime.log("Order stored. Buy pool: " + buyOrders.length + " Sell pool: " + sellOrders.length);

  // Try match
  const match = matchOrders();
  if (!match) {
    runtime.log("No match — queued");
    return JSON.stringify({ status: "queued", side: data.side });
  }

  runtime.log("Match found!");

  // Compute trade amount
  const amountBuy = BigInt(match.buyer.order.amount);
  const amountSell = BigInt(match.seller.order.amount);
  const tradeAmount = amountBuy < amountSell ? amountBuy : amountSell;

  // Generate stealth addresses
  const tradeNonce = keccak256(
    encodePacked(
      ["string", "string", "string"],
      [match.buyer.nullifierHash, match.seller.nullifierHash, Date.now().toString()]
    )
  );

  const stealthBuyer = generateStealthAddress(match.buyer.stealthPublicKey, tradeNonce);
  const stealthSeller = generateStealthAddress(match.seller.stealthPublicKey, tradeNonce);

  const orderId = keccak256(
    encodePacked(
      ["string", "string", "string"],
      [tradeNonce, stealthBuyer, stealthSeller]
    )
  );

  // Encode settle report: type=1, orderId, stealthBuyer, stealthSeller, tokenA, tokenB, amountA, amountB
  const reportData = encodeAbiParameters(
    parseAbiParameters(
      "uint8 reportType, bytes32 orderId, address stealthBuyer, address stealthSeller, address tokenA, address tokenB, uint256 amountA, uint256 amountB"
    ),
    [
      1,
      orderId as `0x${string}`,
      stealthBuyer as `0x${string}`,
      stealthSeller as `0x${string}`,
      match.seller.order.asset as `0x${string}`,
      match.seller.order.quoteToken as `0x${string}`,
      tradeAmount,
      tradeAmount,
    ]
  );

  const txHash = sendReport(runtime, reportData);
  runtime.log("Settlement tx: " + txHash);

  return JSON.stringify({
    status: "settled",
    orderId,
    stealthBuyer,
    stealthSeller,
    tradeAmount: tradeAmount.toString(),
    txHash,
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
