import { Hono } from "hono";
import prisma from "../clients/prisma";
import { sendToCRE } from "../lib/cre-client";
import { streamText } from "hono/streaming";
import { authMiddleware } from "../middleware/auth";

type Variables = {
    user: string;
    sessionId: string;
};

const withdraw = new Hono<{ Variables: Variables }>();

interface WithdrawPayload {
    token: string;
    amount: string;
    withdrawalId: string;
}

// ── POST / — Process withdrawal after on-chain requestWithdrawal ──
withdraw.post("/", authMiddleware, async (c) => {
    const body = await c.req.json<WithdrawPayload>();
    const userAddress = c.get("user") as string;

    const required = ["token", "amount", "withdrawalId"] as const;
    for (const field of required) {
        if (!body[field]) {
            return c.json({ error: `Missing required field: ${field}` }, 400);
        }
    }

    const requestedAmount = BigInt(body.amount);
    if (requestedAmount <= 0n) {
        return c.json({ error: "amount must be positive" }, 400);
    }

    try {
        // Prevent duplicate processing
        const existing = await prisma.withdrawal.findUnique({
            where: { withdrawalId: body.withdrawalId },
        });

        if (existing) {
            if (existing.status === "COMPLETED") {
                return c.json({ error: "Withdrawal already completed", withdrawalId: body.withdrawalId }, 409);
            }
            if (existing.status === "PROCESSING") {
                return c.json({ error: "Withdrawal already in progress", withdrawalId: body.withdrawalId }, 409);
            }
        }

        // Check balance
        const balanceRecord = await prisma.tokenBalance.findUnique({
            where: {
                userAddress_token: {
                    userAddress,
                    token: body.token,
                },
            },
        });

        const currentBalance = balanceRecord ? BigInt(balanceRecord.balance) : 0n;
        if (currentBalance < requestedAmount) {
            return c.json({
                error: "Insufficient balance",
                available: currentBalance.toString(),
                requested: body.amount,
            }, 400);
        }

        // Deduct balance + create/update withdrawal record atomically
        const newBalance = currentBalance - requestedAmount;

        await prisma.$transaction([
            prisma.tokenBalance.update({
                where: {
                    userAddress_token: {
                        userAddress,
                        token: body.token,
                    },
                },
                data: { balance: newBalance.toString() },
            }),
            existing
                ? prisma.withdrawal.update({
                    where: { withdrawalId: body.withdrawalId },
                    data: { status: "PROCESSING" },
                })
                : prisma.withdrawal.create({
                    data: {
                        withdrawalId: body.withdrawalId,
                        userAddress,
                        token: body.token,
                        amount: body.amount,
                        status: "PROCESSING",
                    },
                }),
        ]);

        console.log(`[withdraw] Deducted ${body.amount} from ${userAddress}. New balance: ${newBalance}`);

        // Stream CRE progress
        return streamText(c, async (stream) => {
            await stream.writeln(JSON.stringify({
                type: "log",
                message: "Balance deducted. Forwarding withdrawal to CRE...",
            }));

            try {
                const creResponse = await sendToCRE(
                    {
                        action: "withdraw",
                        withdrawalId: body.withdrawalId,
                        userAddress,
                        amount: body.amount,
                        token: body.token,
                    },
                    async (log) => {
                        await stream.writeln(JSON.stringify({ type: "log", message: log }));
                    },
                );

                await prisma.withdrawal.update({
                    where: { withdrawalId: body.withdrawalId },
                    data: { status: "COMPLETED" },
                });

                await stream.writeln(JSON.stringify({
                    type: "result",
                    success: true,
                    withdrawalId: body.withdrawalId,
                    status: "COMPLETED",
                    cre: creResponse,
                }));
            } catch (err) {
                console.error("[withdraw] CRE failed:", err);

                // Refund the balance on failure
                const refundRecord = await prisma.tokenBalance.findUnique({
                    where: {
                        userAddress_token: { userAddress, token: body.token },
                    },
                });
                const refundBalance = (refundRecord ? BigInt(refundRecord.balance) : 0n) + requestedAmount;

                await prisma.$transaction([
                    prisma.tokenBalance.update({
                        where: {
                            userAddress_token: { userAddress, token: body.token },
                        },
                        data: { balance: refundBalance.toString() },
                    }),
                    prisma.withdrawal.update({
                        where: { withdrawalId: body.withdrawalId },
                        data: { status: "FAILED" },
                    }),
                ]);

                console.log(`[withdraw] Refunded ${body.amount} to ${userAddress} after CRE failure`);

                await stream.writeln(JSON.stringify({
                    type: "error",
                    error: "Withdrawal failed — balance refunded",
                    detail: err instanceof Error ? err.message : String(err),
                }));
            }
        });
    } catch (err) {
        console.error("[withdraw] Process failed:", err);
        return c.json({ error: "Failed to process withdrawal", detail: String(err) }, 500);
    }
});

// ── GET / — List user's withdrawals ──
withdraw.get("/", authMiddleware, async (c) => {
    const userAddress = c.get("user") as string;
    const status = c.req.query("status");

    try {
        const whereClause: any = { userAddress };
        if (status) {
            whereClause.status = status;
        }

        const withdrawals = await prisma.withdrawal.findMany({
            where: whereClause,
            orderBy: { createdAt: "desc" },
        });

        return c.json({ success: true, withdrawals });
    } catch (err) {
        console.error("[withdraw] Get withdrawals failed:", err);
        return c.json({ error: "Failed to fetch withdrawals" }, 500);
    }
});

export { withdraw };
