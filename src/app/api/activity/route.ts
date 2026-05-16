import { db } from "@/lib/db";
import { json } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  const recent = await db.task.findMany({
    where: { status: { in: ["paid", "refunded"] } },
    orderBy: { createdAt: "desc" },
    take: 8,
    include: { agent: true },
  });

  const items = recent.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    bounty_usdc: t.bountyUsdc,
    agent_label: t.agent?.label ?? "",
    worker_wallet: t.claimedByWallet,
    payout_tx: t.payoutTxSig,
    refund_tx: t.refundTxSig,
    escrow_pda: t.escrowPda,
    created_at: t.createdAt,
  }));

  // Lifetime totals.
  const totals = await db.task.aggregate({
    _sum: { bountyUsdc: true },
    _count: { _all: true },
    where: { status: "paid" },
  });
  const totalTasks = await db.task.count();
  const totalWorkers = await db.worker.count();

  return json({
    items,
    stats: {
      total_paid_tasks: totals._count._all,
      total_usdc_paid: totals._sum.bountyUsdc ?? 0,
      total_tasks: totalTasks,
      total_workers: totalWorkers,
    },
  });
}
