import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface TaskSummary {
  id: string;
  title: string;
  description: string;
  bounty_usdc: number;
  verification_method: string;
  deadline_at: string;
  status: string;
  agent_label?: string;
}

const statusVariant: Record<string, "default" | "secondary" | "success" | "warning" | "destructive" | "outline"> = {
  open: "success",
  claimed: "warning",
  submitted: "secondary",
  paid: "default",
  disputed: "destructive",
  refunded: "outline",
  expired: "outline",
};

export function TaskCard({ task }: { task: TaskSummary }) {
  const deadline = new Date(task.deadline_at);
  const hoursLeft = Math.max(0, Math.round((deadline.getTime() - Date.now()) / 3600_000));
  return (
    <Link href={`/tasks/${task.id}`}>
      <Card className="h-full transition-shadow hover:shadow-md">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <CardTitle className="text-lg">{task.title}</CardTitle>
            <Badge variant={statusVariant[task.status] ?? "outline"}>{task.status}</Badge>
          </div>
          <CardDescription className="line-clamp-2">{task.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-semibold">${task.bounty_usdc.toFixed(2)} USDC</span>
            <span className="text-muted-foreground">{task.verification_method}</span>
            <span className="text-muted-foreground">{hoursLeft}h left</span>
            {task.agent_label && <span className="text-muted-foreground">from {task.agent_label}</span>}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
