import { z } from "zod";
import { db } from "@/lib/db";
import { authenticateAgent, extractApiKey } from "@/lib/auth/agent-api-key";
import { json, error, unauthorized, serializeTask } from "@/lib/api-helpers";
import { createEscrow, newTaskNonce, taskNonceToHex } from "@/lib/solana/escrow-client";
import { loadKeypairFromBase58 } from "@/lib/solana/connection";
import { VERIFICATION_METHODS } from "@/lib/constants";

export const dynamic = "force-dynamic";

const CreateBody = z.object({
  title: z.string().min(3).max(140),
  description: z.string().min(10).max(4000),
  acceptance_criteria: z.union([z.string(), z.record(z.unknown()), z.array(z.unknown())]),
  bounty_amount_usdc: z.number().positive().max(10000),
  deadline_hours: z.number().positive().max(24 * 30),
  verification_method: z.enum(VERIFICATION_METHODS),
  agent_wallet_address: z.string().optional(),
});

export async function POST(req: Request) {
  const agent = await authenticateAgent(extractApiKey(req));
  if (!agent) return unauthorized("Missing or invalid API key");

  let body: unknown;
  try { body = await req.json(); } catch { return error("Body must be JSON"); }
  const parse = CreateBody.safeParse(body);
  if (!parse.success) return error("Invalid body: " + parse.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join("; "));
  const b = parse.data;

  const deadlineAt = new Date(Date.now() + b.deadline_hours * 3600 * 1000);
  const nonce = newTaskNonce();
  const nonceHex = taskNonceToHex(nonce);

  // Fund the escrow on chain. The agent's stored Solana keypair signs as the
  // funder; the platform keypair is the authority that may later release/refund.
  const agentKeypair = loadKeypairFromBase58(agent.walletSecret);
  let escrowPda: string;
  let signature: string;
  try {
    const result = await createEscrow({
      agentKeypair,
      bountyUsdc: b.bounty_amount_usdc,
      taskNonce: nonce,
    });
    escrowPda = result.escrowPda.toBase58();
    signature = result.signature;
  } catch (e: any) {
    return error("Escrow funding failed: " + (e.message ?? String(e)), 500);
  }

  const task = await db.task.create({
    data: {
      agentId: agent.id,
      title: b.title,
      description: b.description,
      acceptanceCriteriaJson: JSON.stringify(b.acceptance_criteria),
      bountyUsdc: b.bounty_amount_usdc,
      verificationMethod: b.verification_method,
      deadlineAt,
      status: "open",
      escrowPda,
      escrowFundedTxSig: signature,
      taskNonce: nonceHex,
    },
    include: { agent: true },
  });

  await db.agent.update({
    where: { id: agent.id },
    data: { postedCount: { increment: 1 }, totalSpentUsdc: { increment: b.bounty_amount_usdc } },
  });

  return json({ task: serializeTask(task), escrow_tx: signature }, { status: 201 });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const method = url.searchParams.get("verification_method");
  const minBounty = url.searchParams.get("min_bounty");
  const maxBounty = url.searchParams.get("max_bounty");

  const where: any = {};
  if (status) where.status = status;
  else where.status = { in: ["open", "claimed", "submitted"] };
  if (method) where.verificationMethod = method;
  if (minBounty || maxBounty) {
    where.bountyUsdc = {};
    if (minBounty) where.bountyUsdc.gte = parseFloat(minBounty);
    if (maxBounty) where.bountyUsdc.lte = parseFloat(maxBounty);
  }

  const tasks = await db.task.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { agent: true },
  });
  return json({ tasks: tasks.map(serializeTask) });
}
