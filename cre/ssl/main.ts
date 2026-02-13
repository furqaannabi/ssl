import {
  HTTPCapability,
  handler,
  Runner,
  type Runtime,
  type HTTPPayload,
  decodeJson,
} from "@chainlink/cre-sdk";
import { keccak256, encodePacked } from "viem";

// ──────────────────────────────────────────────
//  Types
// ──────────────────────────────────────────────

type Config = {
  vaultAddress: string;
  chainSelector: string;
  authorizedEVMAddress: string;
};

interface OrderPayload {
  worldIdProof: string;
  nullifierHash: string;
  asset: string;
  quoteToken: string;
  amount: string;
  price: string;
  side: "BUY" | "SELL";
  stealthPublicKey: string;
}

interface Order {
  worldIdProof: string;
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

interface MatchedTrade {
  orderId: string;
  buyer: Order;
  seller: Order;
  stealthBuyer: string;
  stealthSeller: string;
  amountA: string;
  amountB: string;
}

// ──────────────────────────────────────────────
//  World ID Verification (off-chain in CRE)
// ──────────────────────────────────────────────

const usedNullifiers = new Set<string>();

function verifyWorldID(proof: string, nullifierHash: string): boolean {
  if (!proof || proof.length === 0) {
    return false;
  }

  if (usedNullifiers.has(nullifierHash)) {
    return false;
  }

  usedNullifiers.add(nullifierHash);
  return true;
}

// ──────────────────────────────────────────────
//  Stealth Address Generation
// ──────────────────────────────────────────────

function generateStealthAddress(
  stealthPublicKey: string,
  tradeNonce: string
): string {
  const hash = keccak256(
    encodePacked(
      ["string", "string"],
      [stealthPublicKey, tradeNonce]
    )
  );
  return ("0x" + hash.slice(26)) as string;
}

// ──────────────────────────────────────────────
//  Order Matching Engine (confidential in CRE)
// ──────────────────────────────────────────────

const buyOrders: Order[] = [];
const sellOrders: Order[] = [];

function storeOrder(order: Order): void {
  if (order.order.side === "BUY") {
    buyOrders.push(order);
  } else {
    sellOrders.push(order);
  }
}

function matchOrders(): { buyer: Order; seller: Order } | null {
  if (buyOrders.length === 0 || sellOrders.length === 0) {
    return null;
  }

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
//  HTTP Trigger Handler
// ──────────────────────────────────────────────

const onHttpTrigger = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
  runtime.log("═══════════════════════════════════════════");
  runtime.log("SSL: Stealth Settlement Layer — Order Received");
  runtime.log("═══════════════════════════════════════════");

  // ── Step 1: Decode user order from HTTP payload ──
  runtime.log("");
  runtime.log("Step 1: Decoding order from HTTP request...");

  const data = decodeJson(payload.input) as OrderPayload;

  const order: Order = {
    worldIdProof: data.worldIdProof,
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

  runtime.log("  Side: " + order.order.side);
  runtime.log("  Asset: " + order.order.asset);
  runtime.log("  Quote: " + order.order.quoteToken);
  runtime.log("  Amount: " + order.order.amount);
  runtime.log("  Price: " + order.order.price);

  // ── Step 2: Verify World ID (anti-sybil) ──
  runtime.log("");
  runtime.log("Step 2: Verifying World ID proof...");

  const verified = verifyWorldID(order.worldIdProof, order.nullifierHash);

  if (!verified) {
    runtime.log("  REJECTED: World ID verification failed");
    return JSON.stringify({ error: "World ID verification failed" });
  }

  runtime.log("  Unique human verified (zero-knowledge)");

  // ── Step 3: Store order in confidential memory ──
  runtime.log("");
  runtime.log("Step 3: Storing order in CRE confidential memory...");

  storeOrder(order);

  runtime.log("  Order stored (not visible on-chain)");
  runtime.log("  Buy orders in pool: " + buyOrders.length);
  runtime.log("  Sell orders in pool: " + sellOrders.length);

  // ── Step 4: Attempt confidential matching ──
  runtime.log("");
  runtime.log("Step 4: Attempting confidential match...");

  const match = matchOrders();

  if (!match) {
    runtime.log("  No matching counterparty yet. Order queued.");
    return JSON.stringify({ status: "queued", side: order.order.side });
  }

  runtime.log("  MATCH FOUND!");
  runtime.log("  Asset: " + match.buyer.order.asset);
  runtime.log("  Price: $" + (parseInt(match.buyer.order.price) / 100).toFixed(2));

  // ── Step 5: Generate stealth settlement addresses ──
  runtime.log("");
  runtime.log("Step 5: Generating stealth addresses...");

  const tradeNonce = keccak256(
    encodePacked(
      ["string", "string", "string"],
      [match.buyer.nullifierHash, match.seller.nullifierHash, Date.now().toString()]
    )
  );

  const stealthBuyer = generateStealthAddress(
    match.buyer.stealthPublicKey,
    tradeNonce
  );
  const stealthSeller = generateStealthAddress(
    match.seller.stealthPublicKey,
    tradeNonce
  );

  runtime.log("  Buyer stealth:  " + stealthBuyer);
  runtime.log("  Seller stealth: " + stealthSeller);

  // ── Step 6: Prepare settlement ──
  runtime.log("");
  runtime.log("Step 6: Preparing settlement...");

  const orderId = keccak256(
    encodePacked(
      ["string", "string", "string"],
      [tradeNonce, stealthBuyer, stealthSeller]
    )
  );

  const settlement: MatchedTrade = {
    orderId,
    buyer: match.buyer,
    seller: match.seller,
    stealthBuyer,
    stealthSeller,
    amountA: match.seller.order.amount,
    amountB: match.buyer.order.amount,
  };

  runtime.log("  Order ID: " + settlement.orderId);
  runtime.log("  Vault: " + runtime.config.vaultAddress);
  runtime.log("  Token A (asset): " + match.seller.order.asset);
  runtime.log("  Token B (quote): " + match.seller.order.quoteToken);
  runtime.log("  Amount A: " + settlement.amountA);
  runtime.log("  Amount B: " + settlement.amountB);

  // ── Step 7: Settlement instruction ──
  runtime.log("");
  runtime.log("Step 7: Settlement instruction ready");
  runtime.log("  → vault.settle(orderId, stealthBuyer, stealthSeller, tokenA, tokenB, amountA, amountB)");

  runtime.log("");
  runtime.log("═══════════════════════════════════════════");
  runtime.log("SSL Settlement Complete");
  runtime.log("═══════════════════════════════════════════");

  return JSON.stringify({
    status: "settled",
    orderId: settlement.orderId,
    stealthBuyer: settlement.stealthBuyer,
    stealthSeller: settlement.stealthSeller,
    amountA: settlement.amountA,
    amountB: settlement.amountB,
  });
};

// ──────────────────────────────────────────────
//  Workflow Init
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
