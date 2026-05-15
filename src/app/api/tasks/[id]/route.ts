import { db } from "@/lib/db";
import { json, notFound, serializeTask } from "@/lib/api-helpers";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const task = await db.task.findUnique({
    where: { id: params.id },
    include: { agent: true, submissions: true, disputes: true },
  });
  if (!task) return notFound("Task not found");
  return json({ task: serializeTask(task) });
}
