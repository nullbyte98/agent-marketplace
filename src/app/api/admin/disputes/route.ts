import { db } from "@/lib/db";
import { json } from "@/lib/api-helpers";

export const dynamic = "force-dynamic";

export async function GET() {
  const disputes = await db.dispute.findMany({
    where: { resolution: null },
    orderBy: { createdAt: "desc" },
    include: { task: { include: { agent: true, submissions: { take: 1, orderBy: { submittedAt: "desc" } } } } },
  });
  return json({ disputes });
}
