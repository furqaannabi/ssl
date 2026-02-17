
import { ethers } from "ethers";
import prisma from "../clients/prisma";
import { sendToCRE } from "../lib/cre-client";
import { config } from "../lib/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load contract address
const contractsPath = path.resolve(__dirname, "../../contracts.json");
if (!fs.existsSync(contractsPath)) {
    console.warn("[Listener] contracts.json not found, skipping listener startup.");
}
const contracts = fs.existsSync(contractsPath) ? JSON.parse(fs.readFileSync(contractsPath, "utf-8")) : {};
const VAULT_ADDRESS = contracts.vault;

// Minimal ABIs
const VAULT_ABI = [
    "event Funded(address indexed token, uint256 amount, address indexed user)",
    "event WithdrawalRequested(address indexed user, uint256 amount, uint256 indexed withdrawalId, uint256 timestamp)",
    "function withdrawalRequests(uint256) view returns (address token, uint256 amount, bool claimed)"
];

const ERC20_ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)"
];

/**
 * Ensure Token and Pair records exist for a deposited token.
 * Creates a TOKEN/USDC pair if the token isn't USDC itself.
 */
async function ensurePairExists(tokenAddress: string, provider: ethers.WebSocketProvider) {
    const address = tokenAddress.toLowerCase();
    const usdcAddress = config.usdcAddress.toLowerCase();

    // Skip if the deposited token is USDC itself
    if (address === usdcAddress) return;

    // Check if pair already exists
    const existingPair = await prisma.pair.findUnique({
        where: {
            baseTokenAddress_quoteTokenAddress: {
                baseTokenAddress: address,
                quoteTokenAddress: usdcAddress,
            }
        }
    });

    if (existingPair) return;

    console.log(`[Listener] New token detected: ${address}. Creating pair...`);

    const erc20 = new ethers.Contract(tokenAddress, ERC20_ABI, provider);

    // Fetch on-chain metadata for the deposited token
    let name = "Unknown";
    let symbol = "???";
    let decimals = 18;
    try {
        [name, symbol, decimals] = await Promise.all([
            erc20.name(),
            erc20.symbol(),
            erc20.decimals().then(Number),
        ]);
    } catch (err) {
        console.warn(`[Listener] Could not fetch ERC20 metadata for ${address}:`, err);
    }

    // Upsert deposited token
    await prisma.token.upsert({
        where: { address },
        update: {},
        create: { address, name, symbol, decimals },
    });

    // Upsert USDC token (in case it hasn't been seeded yet)
    await prisma.token.upsert({
        where: { address: usdcAddress },
        update: {},
        create: { address: usdcAddress, name: "USD Coin", symbol: "USDC", decimals: 6 },
    });

    // Create the pair
    await prisma.pair.create({
        data: {
            baseTokenAddress: address,
            quoteTokenAddress: usdcAddress,
        },
    });

    console.log(`[Listener] Created pair ${symbol}/USDC for token ${address}`);
}

export async function startVaultListener() {
    if (!VAULT_ADDRESS) {
        console.warn("[Listener] VAULT_ADDRESS not found in contracts.json. Listener disabled.");
        return;
    }

    const WS_URL = `wss://base-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;

    try {
        const provider = new ethers.WebSocketProvider(WS_URL);
        // Quick check if provider is connected
        await provider.getNetwork();

        const contract = new ethers.Contract(VAULT_ADDRESS, VAULT_ABI, provider);

        // ── Funded Event ──
        contract.on("Funded", async (token, amount, user, event) => {
            console.log(`[Listener] Funded: ${user} deposited ${amount.toString()} of ${token}`);

            try {
                // Upsert User
                await prisma.user.upsert({
                    where: { address: user },
                    update: {},
                    create: {
                        address: user,
                        name: `User ${user.slice(0, 6)}`
                    }
                });

                // Auto-create Token + Pair if this is a new token
                await ensurePairExists(token, provider);

                // Get Current Balance
                const currentRecord = await prisma.tokenBalance.findUnique({
                    where: {
                        userAddress_token: {
                            userAddress: user,
                            token: token
                        }
                    }
                });

                const currentBalance = currentRecord ? BigInt(currentRecord.balance) : BigInt(0);
                const newBalance = currentBalance + BigInt(amount);

                // Update Balance
                await prisma.tokenBalance.upsert({
                    where: {
                        userAddress_token: {
                            userAddress: user,
                            token: token
                        }
                    },
                    update: {
                        balance: newBalance.toString()
                    },
                    create: {
                        userAddress: user,
                        token: token,
                        balance: newBalance.toString()
                    }
                });

                console.log(`[Listener] Updated balance for ${user}: ${newBalance.toString()}`);

            } catch (err) {
                console.error("[Listener] Error handling Funded event:", err);
            }
        });

        // ── WithdrawalRequested Event ──
        contract.on("WithdrawalRequested", async (user, amount, withdrawalId, timestamp, event) => {
            console.log(`[Listener] WithdrawalRequested: ID ${withdrawalId} by ${user} for amount ${amount}`);

            try {
                // Fetch Token from Contract State
                // withdrawalRequests(id) -> (token, amount, claimed)
                const request = await contract.withdrawalRequests(withdrawalId);
                const token = request.token;
                // Verify amount matches?
                // request.amount should match event amount.

                console.log(`[Listener] Withdrawal details: Token ${token}, Amount ${request.amount}`);

                // Check Database Balance
                const balanceRecord = await prisma.tokenBalance.findUnique({
                    where: {
                        userAddress_token: {
                            userAddress: user,
                            token: token
                        }
                    }
                });

                const currentBalance = balanceRecord ? BigInt(balanceRecord.balance) : BigInt(0);
                const requestedAmount = BigInt(amount);

                if (currentBalance >= requestedAmount) {
                    // Deduct Balance
                    const newBalance = currentBalance - requestedAmount;

                    await prisma.tokenBalance.update({
                        where: {
                            userAddress_token: {
                                userAddress: user,
                                token: token
                            }
                        },
                        data: {
                            balance: newBalance.toString()
                        }
                    });

                    console.log(`[Listener] Deducted ${requestedAmount} from ${user}. New Balance: ${newBalance}`);

                    // Forward to CRE
                    console.log(`[Listener] Forwarding withdrawal to CRE...`);
                    const result = await sendToCRE({
                        action: "withdraw",
                        withdrawalId: withdrawalId.toString(),
                        userAddress: user,
                        amount: amount.toString(),
                        token: token
                    });

                    console.log(`[Listener] CRE Withdrawal Result:`, result);

                } else {
                    console.error(`[Listener] Insufficient balance for withdrawal ${withdrawalId}. User has ${currentBalance}, requested ${requestedAmount}.`);
                    // TODO: Could flag this withdrawal as "Pending Funding" or "Invalid" in DB if we tracked requests.
                }

            } catch (err) {
                console.error("[Listener] Error handling WithdrawalRequested:", err);
            }
        });

        console.log("[Listener] Listener attached successfully.");

        // Keep function running to prevent exit, but also handle connection errors
        await new Promise((resolve, reject) => {
            provider.on("error", (err) => {
                console.error("[Listener] Provider Error:", err);
                reject(err);
            });
        });

    } catch (err) {
        console.error("[Listener] RPC Error or Connection Dropped:", err);
        console.log("[Listener] Reconnecting in 5s...");
        await new Promise(r => setTimeout(r, 5000));
        return startVaultListener(); // Recursive restart
    }
}
