import { ethers } from "ethers";
import prisma from "../clients/prisma";
import { sendToCRE } from "../lib/cre-client";
import { getActiveChains, type ChainConfig } from "../lib/config";

const VAULT_ABI = [
    "event Funded(address indexed token, uint256 amount, address indexed user)",
    "event WithdrawalRequested(address indexed user, uint256 amount, uint256 indexed withdrawalId, uint256 timestamp)",
    "event Settled(bytes32 indexed orderId, address stealthBuyer, address stealthSeller)",
    "event CrossChainSettled(bytes32 indexed orderId, uint64 destChainSelector, address recipient, bytes32 ccipMessageId)",
    "function withdrawalRequests(uint256) view returns (address token, uint256 amount, bool claimed)"
];

const CCIP_RECEIVER_ABI = [
    "event TokenReleased(bytes32 indexed orderId, address recipient, address token, uint256 amount, bytes32 ccipMessageId)"
];

const ERC20_ABI = [
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)"
];

/**
 * Ensure Token and Pair records exist for a deposited token on a given chain.
 */
async function ensurePairExists(
    tokenAddress: string,
    chainSelector: string,
    usdcAddress: string,
    provider: ethers.WebSocketProvider
) {
    const address = tokenAddress.toLowerCase();
    const usdc = usdcAddress.toLowerCase();

    if (address === usdc) return;

    const existingPair = await prisma.pair.findUnique({
        where: {
            baseTokenAddress_quoteTokenAddress: {
                baseTokenAddress: address,
                quoteTokenAddress: usdc,
            }
        }
    });
    if (existingPair) return;

    console.log(`[Listener:${chainSelector}] New token detected: ${address}. Creating pair...`);

    const erc20 = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
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
        console.warn(`[Listener:${chainSelector}] Could not fetch ERC20 metadata for ${address}:`, err);
    }

    await prisma.token.upsert({
        where: { address },
        update: {},
        create: { address, name, symbol, decimals, chainSelector },
    });

    await prisma.token.upsert({
        where: { address: usdc },
        update: {},
        create: { address: usdc, name: "USD Coin", symbol: "USDC", decimals: 6, chainSelector: "ethereum-testnet-sepolia-base-1" },
    });

    await prisma.pair.create({
        data: {
            baseTokenAddress: address,
            quoteTokenAddress: usdc,
        },
    });

    console.log(`[Listener:${chainSelector}] Created pair ${symbol}/USDC for token ${address}`);
}

/**
 * Replay all historical Funded events missed while the listener was offline.
 * Paginates in 10-block chunks to comply with Alchemy free-tier limits.
 * Safe to run on every startup — deduplicates by txHash so nothing is double-counted.
 */
async function replayMissedEvents(
    contract: ethers.Contract,
    provider: ethers.WebSocketProvider,
    chainSelector: string,
    usdcAddress: string,
    tag: string
): Promise<void> {
    // Configurable chunk size — Alchemy free tier max is 10
    const CHUNK_SIZE = 10;

    try {
        const currentBlock = await provider.getBlockNumber();
        // Look back at most 2000 blocks (practical for free tier — extends on PAYG)
        const fromBlock = Math.max(0, currentBlock - 2000);

        console.log(`${tag} Replaying Funded events from block ${fromBlock} to ${currentBlock} (${CHUNK_SIZE}-block chunks)...`);

        // Load already-recorded deposits for deduplication
        const existingTxHashes = new Set(
            (await prisma.transaction.findMany({
                where: { chainSelector, type: "DEPOSIT" },
                select: { txHash: true, token: true },
            })).map(t => `${t.txHash}:${t.token}`)
        );

        // Build in-memory balance accumulator from current DB state
        const allBalances = await prisma.tokenBalance.findMany({ where: { chainSelector } });
        const balanceMap = new Map<string, bigint>();
        for (const b of allBalances) {
            balanceMap.set(`${b.userAddress}:${b.token}`, BigInt(b.balance));
        }

        let backfilled = 0;

        // Paginate in CHUNK_SIZE-block windows
        for (let start = fromBlock; start <= currentBlock; start += CHUNK_SIZE) {
            const end = Math.min(start + CHUNK_SIZE - 1, currentBlock);
            try {
                const filter = contract.filters.Funded();
                const events = await contract.queryFilter(filter, start, end);

                for (const evt of events) {
                    const log = evt as ethers.EventLog;
                    if (!log.args) continue;

                    const token = (log.args[0] as string).toLowerCase();
                    const amount = BigInt(log.args[1]);
                    const user = (log.args[2] as string).toLowerCase();
                    const txHash = log.transactionHash;

                    const dedupKey = `${txHash}:${token}`;
                    if (existingTxHashes.has(dedupKey)) continue;

                    console.log(`${tag} [Replay] Backfilling: ${user} +${amount} ${token} (tx: ${txHash})`);

                    await prisma.user.upsert({
                        where: { address: user },
                        update: {},
                        create: { address: user, name: `User ${user.slice(0, 6)}` },
                    });

                    if (usdcAddress) {
                        await ensurePairExists(token, chainSelector, usdcAddress, provider);
                    }

                    const balKey = `${user}:${token}`;
                    const currentBal = balanceMap.get(balKey) || 0n;
                    const newBal = currentBal + amount;
                    balanceMap.set(balKey, newBal);

                    await prisma.tokenBalance.upsert({
                        where: { userAddress_token_chainSelector: { userAddress: user, token, chainSelector } },
                        update: { balance: newBal.toString() },
                        create: { userAddress: user, token, chainSelector, balance: newBal.toString() },
                    });

                    await prisma.transaction.create({
                        data: { type: "DEPOSIT", token, amount: amount.toString(), chainSelector, userAddress: user, txHash },
                    });

                    existingTxHashes.add(dedupKey);
                    backfilled++;
                }
            } catch (chunkErr: any) {
                // Log and skip range — don't abort the whole replay
                console.warn(`${tag} [Replay] Skipping blocks ${start}-${end}: ${chunkErr.shortMessage || chunkErr.message}`);
            }

            // Tiny pause to respect rate limits
            await new Promise(r => setTimeout(r, 50));
        }

        console.log(`${tag} Replay complete. Backfilled ${backfilled} deposit(s).`);
    } catch (err) {
        console.error(`${tag} replayMissedEvents failed:`, err);
    }
}

/**
 * Start a WebSocket listener for a single chain's vault.
 */
async function startChainListener(chainName: string, chain: ChainConfig) {
    const tag = `[Listener:${chainName}]`;
    const { vault, chainSelector } = chain;

    if (!vault) {
        console.warn(`${tag} No vault address. Skipping.`);
        return;
    }

    const alchemyKey = process.env.ALCHEMY_API_KEY;
    const wsUrl = alchemyKey ? `${chain.wsUrl}${alchemyKey}` : chain.wsUrl;

    try {
        const provider = new ethers.WebSocketProvider(wsUrl);
        await provider.getNetwork();
        console.log(`${tag} Connected (chainId=${chain.chainId})`);

        const contract = new ethers.Contract(vault, VAULT_ABI, provider);

        // Replay any deposits that were missed while offline
        await replayMissedEvents(contract, provider, chainSelector, chain.usdc || "", tag);

        // ── Funded Event ──
        contract.on("Funded", async (rawToken: string, amount: bigint, rawUser: string, event: any) => {
            const token = rawToken.toLowerCase();
            const user = rawUser.toLowerCase();
            console.log(`${tag} Funded: ${user} deposited ${amount.toString()} of ${token}`);

            try {
                await prisma.user.upsert({
                    where: { address: user },
                    update: {},
                    create: { address: user, name: `User ${user.slice(0, 6)}` }
                });

                const usdcAddr = chain.usdc || "";
                if (usdcAddr) {
                    await ensurePairExists(token, chainSelector, usdcAddr, provider);
                }

                const currentRecord = await prisma.tokenBalance.findUnique({
                    where: {
                        userAddress_token_chainSelector: {
                            userAddress: user,
                            token,
                            chainSelector,
                        }
                    }
                });

                const currentBalance = currentRecord ? BigInt(currentRecord.balance) : 0n;
                const newBalance = currentBalance + BigInt(amount);

                await prisma.tokenBalance.upsert({
                    where: {
                        userAddress_token_chainSelector: {
                            userAddress: user,
                            token,
                            chainSelector,
                        }
                    },
                    update: { balance: newBalance.toString() },
                    create: {
                        userAddress: user,
                        token,
                        chainSelector,
                        balance: newBalance.toString(),
                    }
                });

                await prisma.transaction.create({
                    data: {
                        type: "DEPOSIT",
                        token,
                        amount: amount.toString(),
                        chainSelector,
                        userAddress: user,
                        txHash: event.log.transactionHash,
                    }
                });

                console.log(`${tag} Balance updated for ${user}: ${newBalance.toString()}`);
            } catch (err) {
                console.error(`${tag} Error handling Funded:`, err);
            }
        });

        // ── WithdrawalRequested Event ──
        contract.on("WithdrawalRequested", async (rawUser: string, amount: bigint, withdrawalId: bigint, _timestamp: bigint, event: any) => {
            const user = rawUser.toLowerCase();
            const wId = withdrawalId.toString();
            console.log(`${tag} WithdrawalRequested: ID ${wId} by ${user} for ${amount}`);

            try {
                const existing = await prisma.withdrawal.findUnique({
                    where: { withdrawalId: wId },
                });
                if (existing && (existing.status === "PROCESSING" || existing.status === "COMPLETED")) {
                    console.log(`${tag} Withdrawal ${wId} already handled (${existing.status}). Skipping.`);
                    return;
                }

                const request = await contract.withdrawalRequests(withdrawalId);
                const token = (request.token as string).toLowerCase();

                const balanceRecord = await prisma.tokenBalance.findUnique({
                    where: {
                        userAddress_token_chainSelector: {
                            userAddress: user,
                            token,
                            chainSelector,
                        }
                    }
                });

                const currentBalance = balanceRecord ? BigInt(balanceRecord.balance) : 0n;
                const requestedAmount = BigInt(amount);

                if (currentBalance < requestedAmount) {
                    console.error(`${tag} Insufficient balance for withdrawal ${wId}. Has ${currentBalance}, requested ${requestedAmount}.`);
                    if (!existing) {
                        await prisma.withdrawal.create({
                            data: { withdrawalId: wId, userAddress: user, token, amount: amount.toString(), status: "FAILED" },
                        });
                    }
                    return;
                }

                const newBalance = currentBalance - requestedAmount;

                await prisma.$transaction([
                    prisma.tokenBalance.update({
                        where: {
                            userAddress_token_chainSelector: {
                                userAddress: user,
                                token,
                                chainSelector,
                            }
                        },
                        data: { balance: newBalance.toString() },
                    }),
                    existing
                        ? prisma.withdrawal.update({
                            where: { withdrawalId: wId },
                            data: { status: "PROCESSING" },
                        })
                        : prisma.withdrawal.create({
                            data: { withdrawalId: wId, userAddress: user, token, amount: amount.toString(), status: "PROCESSING" },
                        }),
                ]);

                await prisma.transaction.create({
                    data: {
                        type: "WITHDRAWAL",
                        token,
                        amount: amount.toString(),
                        chainSelector,
                        userAddress: user,
                        txHash: event.log.transactionHash,
                    }
                });

                console.log(`${tag} Deducted ${requestedAmount} from ${user}. New Balance: ${newBalance}`);
                console.log(`${tag} Forwarding withdrawal ${wId} to CRE...`);

                const result = await sendToCRE({
                    action: "withdraw",
                    withdrawalId: wId,
                    userAddress: user,
                    amount: amount.toString(),
                    token,
                });

                await prisma.withdrawal.update({
                    where: { withdrawalId: wId },
                    data: { status: "COMPLETED" },
                });

                console.log(`${tag} CRE Withdrawal Result:`, result);
            } catch (err) {
                console.error(`${tag} Error handling WithdrawalRequested:`, err);
            }
        });

        // ── Settled Event (same-chain) ──
        contract.on("Settled", async (orderId: string, stealthBuyer: string, stealthSeller: string, event: any) => {
            console.log(`${tag} Settled: orderId=${orderId}`);
            try {
                await prisma.settlement.upsert({
                    where: { orderId },
                    update: {
                        status: "SETTLED",
                        stealthBuyer: stealthBuyer.toLowerCase(),
                        stealthSeller: stealthSeller.toLowerCase(),
                        settleTxHash: event.log.transactionHash,
                        sourceChain: chainSelector,
                    },
                    create: {
                        orderId,
                        type: "SAME_CHAIN",
                        status: "SETTLED",
                        sourceChain: chainSelector,
                        stealthBuyer: stealthBuyer.toLowerCase(),
                        stealthSeller: stealthSeller.toLowerCase(),
                        settleTxHash: event.log.transactionHash,
                    },
                });
            } catch (err) {
                console.error(`${tag} Error handling Settled:`, err);
            }
        });

        // ── CrossChainSettled Event ──
        contract.on("CrossChainSettled", async (orderId: string, destChainSel: bigint, recipient: string, ccipMessageId: string, event: any) => {
            console.log(`${tag} CrossChainSettled: orderId=${orderId} ccipMessageId=${ccipMessageId}`);
            try {
                await prisma.settlement.upsert({
                    where: { orderId },
                    update: {
                        status: "BRIDGING",
                        ccipMessageId,
                        destChainSelector: destChainSel.toString(),
                        bridgeTxHash: event.log.transactionHash,
                    },
                    create: {
                        orderId,
                        type: "CROSS_CHAIN",
                        status: "BRIDGING",
                        sourceChain: chainSelector,
                        destChainSelector: destChainSel.toString(),
                        ccipMessageId,
                        stealthSeller: recipient.toLowerCase(),
                        bridgeTxHash: event.log.transactionHash,
                    },
                });
            } catch (err) {
                console.error(`${tag} Error handling CrossChainSettled:`, err);
            }
        });

        // ── TokenReleased Event (from SSLCCIPReceiver) ──
        const receiverAddr = (chain as any).ccipReceiver;
        if (receiverAddr) {
            const receiverContract = new ethers.Contract(receiverAddr, CCIP_RECEIVER_ABI, provider);
            receiverContract.on("TokenReleased", async (orderId: string, recipient: string, token: string, amount: bigint, ccipMessageId: string, event: any) => {
                console.log(`${tag} TokenReleased: orderId=${orderId} recipient=${recipient} token=${token} amount=${amount}`);
                try {
                    await prisma.settlement.upsert({
                        where: { orderId },
                        update: {
                            status: "COMPLETED",
                            stealthBuyer: recipient.toLowerCase(),
                            token: token.toLowerCase(),
                            amount: amount.toString(),
                            ccipMessageId,
                            releaseTxHash: event.log.transactionHash,
                        },
                        create: {
                            orderId,
                            type: "CROSS_CHAIN",
                            status: "COMPLETED",
                            destChain: chainSelector,
                            stealthBuyer: recipient.toLowerCase(),
                            token: token.toLowerCase(),
                            amount: amount.toString(),
                            ccipMessageId,
                            releaseTxHash: event.log.transactionHash,
                        },
                    });
                } catch (err) {
                    console.error(`${tag} Error handling TokenReleased:`, err);
                }
            });
            console.log(`${tag} Listener attached for ccipReceiver ${receiverAddr}`);
        }

        console.log(`${tag} Listener attached for vault ${vault}`);

        await new Promise((_resolve, reject) => {
            provider.on("error", (err) => {
                console.error(`${tag} Provider Error:`, err);
                reject(err);
            });
        });
    } catch (err) {
        console.error(`${tag} Connection failed:`, err);
        console.log(`${tag} Reconnecting in 5s...`);
        await new Promise(r => setTimeout(r, 5000));
        return startChainListener(chainName, chain);
    }
}

/**
 * Start vault listeners for all chains with deployed vaults.
 */
export async function startVaultListener() {
    const activeChains = getActiveChains();

    if (activeChains.length === 0) {
        console.warn("[Listener] No active chains found in addresses.json. Listener disabled.");
        return;
    }

    console.log(`[Listener] Starting listeners for ${activeChains.length} chain(s): ${activeChains.map(([n]) => n).join(", ")}`);

    const listeners = activeChains.map(([name, chain]) =>
        startChainListener(name, chain).catch((err) => {
            console.error(`[Listener] Fatal error on ${name}:`, err);
        })
    );

    await Promise.all(listeners);
}
