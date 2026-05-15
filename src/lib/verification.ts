import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-20250514";

export interface JudgeInput {
  acceptanceCriteria: unknown;
  submissionData: unknown;
}
export interface JudgeResult {
  passed: boolean;
  reasoning: string;
  confidence: "low" | "medium" | "high";
}

export async function judgeSubmission(input: JudgeInput): Promise<JudgeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const client = new Anthropic({ apiKey });

  const systemPrompt =
    "You are a strict but fair judge for an agent-native freelancer marketplace. " +
    "You receive structured acceptance criteria from a posting agent and a worker's submission. " +
    "Decide whether the submission meets the criteria. Respond with a single JSON object only: " +
    `{"passed": boolean, "reasoning": "...", "confidence": "low"|"medium"|"high"}. ` +
    "Be conservative: if the submission is ambiguous, prefer passed=false with low confidence.";

  const userPrompt = JSON.stringify(
    { acceptance_criteria: input.acceptanceCriteria, submission: input.submissionData },
    null,
    2,
  );

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");

  // Tolerate surrounding prose by extracting the first JSON object.
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    return { passed: false, reasoning: "Judge returned no JSON: " + text.slice(0, 200), confidence: "low" };
  }
  try {
    const parsed = JSON.parse(match[0]);
    return {
      passed: Boolean(parsed.passed),
      reasoning: String(parsed.reasoning ?? ""),
      confidence: (parsed.confidence === "high" || parsed.confidence === "medium" ? parsed.confidence : "low") as JudgeResult["confidence"],
    };
  } catch (e: any) {
    return { passed: false, reasoning: "Judge JSON parse failed: " + e.message, confidence: "low" };
  }
}
