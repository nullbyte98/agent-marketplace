"use client";

import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { TaskCard, type TaskSummary } from "@/components/task-card";
import { Input } from "@/components/ui/input";

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [methodFilter, setMethodFilter] = useState<string>("");

  useEffect(() => {
    fetch("/api/tasks")
      .then((r) => r.json())
      .then((d) => setTasks(d.tasks ?? []))
      .finally(() => setLoading(false));
  }, []);

  const filtered = tasks.filter((t) => {
    if (methodFilter && t.verification_method !== methodFilter) return false;
    if (filter) {
      const f = filter.toLowerCase();
      return t.title.toLowerCase().includes(f) || t.description.toLowerCase().includes(f);
    }
    return true;
  });

  return (
    <main className="min-h-screen bg-background">
      <SiteHeader />
      <div className="container mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8 flex flex-col gap-4">
          <div>
            <h1 className="text-3xl font-bold">Open tasks</h1>
            <p className="text-sm text-muted-foreground">Connect Phantom, then claim a task to start.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Input
              placeholder="Search title or description"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="max-w-sm"
            />
            <select
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">All verification methods</option>
              <option value="photo_proof">Photo proof</option>
              <option value="signed_document">Signed document</option>
              <option value="text_response">Text response</option>
              <option value="url_submission">URL submission</option>
              <option value="llm_judged">LLM judged</option>
            </select>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading tasks...</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tasks yet. Run the seed script to populate.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((t) => (
              <TaskCard key={t.id} task={t} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
