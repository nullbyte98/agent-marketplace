import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { db } from "@/lib/db";
import { json, error, notFound } from "@/lib/api-helpers";
import { ADMIN_WALLET_PUBKEY } from "@/lib/constants";
import { releaseToWorker, refundToAgent, taskNonceFromHex } from "@/lib/solana/escrow-client";
import { verifyWalletSignature } from "@/lib/auth/wallet-signature";

const Body = z.object({
  admin_wallet: z.string(),
  signature: z.string(),
  resolution: z.enum(["release", "refund"]),
});

// Admin proves identity with a wallet signature over "admin-resolve:<dispute_id>".
function adminMessage(disputeId: string) {
  return `agent-marketplace.admin-resolve\ndispute:${disputeId}`;
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const parse = Body.safeParse(await req.json().catch(() => null));
  if (!parse.success) return error("Invalid body");
  const { admin_wallet, signature, resolution } = parse.data;

  if (!ADMIN_WALLET_PUBKEY) return error("ADMIN_WALLET_PUBKEY not configured", 500);
  if (admin_wallet !== ADMIN_WALLET_PUBKEY) return error("Not the configured admin", 403);

  const valid = verifyWalletSignature({
    message: adminMessage(params.id),
    signatureBase58: signature,
    walletPubkey: admin_wallet,
  });
  if (!valid) return error("Admin signature does not verify", 403);

  const dispute = await db.dispute.findUnique({
    where: { id: params.id },
    include: { task: { include: { agent: true } } },
  });
  if (!dispute) return notFound("Dispute not found");
  if (dispute.resolution) return error("Already resolved as " + dispute.resolution, 409);

  const task = dispute.task;
  if (!task.claimedByWallet && resolution === "release") return error("Task has no claimer", 409);

  let txSig: string;
  try {
    if (resolution === "release") {
      txSig = await releaseToWorker({
        taskNonce: taskNonceFromHex(task.taskNonce),
        workerPubkey: new PublicKey(task.claimedByWallet!),
      });
    } else {
      txSig = await refundToAgent({
        taskNonce: taskNonceFromHex(task.taskNonce),
        agentPubkey: new PublicKey(task.agent.walletAddress),
      });
    }
  } catch (e: any) {
    return error("On-chain resolution failed: " + (e.message ?? String(e)), 500);
  }

  await db.$transaction([
    db.dispute.update({
      where: { id: dispute.id },
      data: { resolution: resolution === "release" ? "released" : "refunded", resolvedAt: new Date(), resolvedBy: admin_wallet },
    }),
    db.task.update({
      where: { id: task.id },
      data: {
        status: resolution === "release" ? "paid" : "refunded",
        payoutTxSig: resolution === "release" ? txSig : null,
        refundTxSig: resolution === "refund" ? txSig : null,
      },
    }),
  ]);

  // Worker stats update.
  if (task.claimedByWallet) {
    if (resolution === "release") {
      await db.worker.update({
        where: { walletAddress: task.claimedByWallet },
        data: { completedCount: { increment: 1 }, totalEarnedUsdc: { increment: task.bountyUsdc } },
      });
    } else {
      await db.worker.update({
        where: { walletAddress: task.claimedByWallet },
        data: { disputesLost: { increment: 1 } },
      });
    }
  }

  return json({ ok: true, resolution, tx: txSig });
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const dispute = await db.dispute.findUnique({
    where: { id: params.id },
    include: { task: { include: { agent: true } } },
  });
  if (!dispute) return notFound("Dispute not found");
  return json({ dispute });
}
