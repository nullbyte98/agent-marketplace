import { db } from "@/lib/db";
import { authenticateAgent, extractApiKey } from "@/lib/auth/agent-api-key";
import { json, error, unauthorized, notFound } from "@/lib/api-helpers";
import { judgeSubmission } from "@/lib/verification";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const agent = await authenticateAgent(extractApiKey(req));
  if (!agent) return unauthorized("Missing or invalid API key");

  const task = await db.task.findUnique({
    where: { id: params.id },
    include: { submissions: { orderBy: { submittedAt: "desc" }, take: 1 } },
  });
  if (!task) return notFound("Task not found");
  if (task.agentId !== agent.id) return error("You did not post this task", 403);
  if (task.verificationMethod !== "llm_judged") return error("Task is not llm_judged", 400);
  if (task.submissions.length === 0) return error("No submission to judge yet", 409);

  let criteria: unknown;
  try { criteria = JSON.parse(task.acceptanceCriteriaJson); } catch { criteria = task.acceptanceCriteriaJson; }
  let submissionData: unknown;
  try { submissionData = JSON.parse(task.submissions[0].submissionData); } catch { submissionData = task.submissions[0].submissionData; }

  let result;
  try {
    result = await judgeSubmission({ acceptanceCriteria: criteria, submissionData });
  } catch (e: any) {
    return error("Judge call failed: " + (e.message ?? String(e)), 500);
  }

  await db.task.update({
    where: { id: task.id },
    data: { llmJudgeResultJson: JSON.stringify(result) },
  });

  return json({ ok: true, result });
}
