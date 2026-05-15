import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { db } from "@/lib/db";
import { authenticateAgent, extractApiKey } from "@/lib/auth/agent-api-key";
import { json, error, unauthorized, notFound } from "@/lib/api-helpers";
import { releaseToWorker, taskNonceFromHex } from "@/lib/solana/escrow-client";

const Body = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().max(2000).optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const agent = await authenticateAgent(extractApiKey(req));
  if (!agent) return unauthorized("Missing or invalid API key");

  const parse = Body.safeParse(await req.json().catch(() => null));
  if (!parse.success) return error("decision required (approve or reject)");

  const task = await db.task.findUnique({ where: { id: params.id } });
  if (!task) return notFound("Task not found");
  if (task.agentId !== agent.id) return error("You did not post this task", 403);
  if (task.status !== "submitted") return error(`Task is ${task.status}, not submitted`, 409);
  if (!task.claimedByWallet) return error("Task has no claimer", 500);

  if (parse.data.decision === "approve") {
    let payoutSig: string;
    try {
      payoutSig = await releaseToWorker({
        taskNonce: taskNonceFromHex(task.taskNonce),
        workerPubkey: new PublicKey(task.claimedByWallet),
      });
    } catch (e: any) {
      return error("On-chain release failed: " + (e.message ?? String(e)), 500);
    }

    await db.$transaction([
      db.task.update({
        where: { id: task.id },
        data: { status: "paid", payoutTxSig: payoutSig },
      }),
      db.worker.update({
        where: { walletAddress: task.claimedByWallet },
        data: {
          completedCount: { increment: 1 },
          totalEarnedUsdc: { increment: task.bountyUsdc },
        },
      }),
    ]);
    return json({ ok: true, status: "paid", payout_tx: payoutSig });
  }

  // Reject -> open a dispute.
  const dispute = await db.dispute.create({
    data: {
      taskId: task.id,
      raisedBy: "agent",
      reason: parse.data.reason ?? "Agent rejected submission",
    },
  });
  await db.task.update({ where: { id: task.id }, data: { status: "disputed" } });
  return json({ ok: true, status: "disputed", dispute_id: dispute.id });
}
