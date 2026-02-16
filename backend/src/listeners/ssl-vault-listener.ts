
import { ethers } from "ethers";
import prisma from "../clients/prisma";
import { sendToCRE } from "../lib/cre-client";
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

// Minimal ABI
const VAULT_ABI = [
    "event Funded(address indexed token, uint256 amount, address indexed user)",
    "event WithdrawalRequested(address indexed user, uint256 amount, uint256 indexed withdrawalId, uint256 timestamp)",
    "function withdrawalRequests(uint256) view returns (address token, uint256 amount, bool claimed)"
];

export async function startVaultListener() {
    if (!VAULT_ADDRESS) {
        console.warn("[Listener] VAULT_ADDRESS not found in contracts.json. Listener disabled.");
        return;
    }

    const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
    console.log(`[Listener] Starting SSLVault listener on ${VAULT_ADDRESS} via ${RPC_URL}...`);

    try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
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

    } catch (err) {
        console.error("[Listener] Failed to start listener (RPC error?):", err);
    }
}
