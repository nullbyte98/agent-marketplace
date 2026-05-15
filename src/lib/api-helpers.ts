import { NextResponse } from "next/server";

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init);
}
export function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
export function unauthorized(message = "Unauthorized") {
  return error(message, 401);
}
export function notFound(message = "Not found") {
  return error(message, 404);
}

export function serializeTask(t: any) {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    acceptance_criteria: safeParse(t.acceptanceCriteriaJson),
    bounty_usdc: t.bountyUsdc,
    verification_method: t.verificationMethod,
    deadline_at: t.deadlineAt,
    status: t.status,
    claimed_by_wallet: t.claimedByWallet,
    claimed_at: t.claimedAt,
    submitted_at: t.submittedAt,
    submission_data: safeParse(t.submissionDataJson),
    escrow_pda: t.escrowPda,
    escrow_funded_tx_sig: t.escrowFundedTxSig,
    payout_tx_sig: t.payoutTxSig,
    refund_tx_sig: t.refundTxSig,
    llm_judge_result: safeParse(t.llmJudgeResultJson),
    created_at: t.createdAt,
    agent_label: t.agent?.label,
  };
}
function safeParse(s: string | null | undefined) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return s; }
}
