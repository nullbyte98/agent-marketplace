"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";

interface Event {
  step: string;
  message: string;
  task_id?: string;
  tx?: string;
  worker?: string;
  agent_label?: string;
  bounty?: number;
}

const STEP_ORDER = ["posting", "posted", "claiming", "claimed", "submitting", "submitted", "approving", "approved", "complete"];
const STEP_LABEL: Record<string, string> = {
  posting: "Agent posting task",
  posted: "Task posted, escrow funded",
  claiming: "Worker claiming",
  claimed: "Worker bound on chain",
  submitting: "Worker submitting",
  submitted: "Submission accepted",
  approving: "Agent approving",
  approved: "USDC released",
  complete: "Done",
};

export function WatchTheLoop() {
  const [events, setEvents] = useState<Event[]>([]);
  const [running, setRunning] = useState(false);
  const [errored, setErrored] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  function start() {
    setEvents([]);
    setErrored(false);
    setRunning(true);
    const es = new EventSource("/api/demo/run");
    sourceRef.current = es;
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as Event;
        setEvents((prev) => [...prev, data]);
        if (data.step === "complete" || data.step === "error") {
          if (data.step === "error") setErrored(true);
          es.close();
          setRunning(false);
        }
      } catch {}
    };
    es.onerror = () => {
      es.close();
      setRunning(false);
    };
  }

  const completed = new Set(events.map((e) => e.step));
  const txByStep: Record<string, string | undefined> = {};
  for (const e of events) if (e.tx) txByStep[e.step] = e.tx;

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium">One click. Real on-chain transactions on Solana devnet.</p>
          <p className="text-xs text-muted-foreground">
            ~15-25 seconds. Four real Solana transactions you can open on Explorer.
          </p>
        </div>
        <Button onClick={start} disabled={running} size="lg">
          {running ? "Running..." : events.length > 0 ? "Run again" : "Run live demo"}
        </Button>
      </div>

      <ol className="mt-6 space-y-3">
        {STEP_ORDER.filter((s) => s !== "complete").map((step) => {
          const ev = events.find((e) => e.step === step);
          const done = completed.has(step) || completed.has("complete");
          const active = running && !done && events.length > 0 && events[events.length - 1].step === priorTo(step);
          const tx = txByStep[step];
          return (
            <li key={step} className="flex items-start gap-3">
              <span
                className={
                  done
                    ? "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-500 text-xs text-white"
                    : active
                    ? "mt-0.5 inline-flex h-5 w-5 shrink-0 animate-pulse items-center justify-center rounded-full bg-amber-400 text-xs"
                    : "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-xs text-muted-foreground"
                }
              >
                {done ? "✓" : ""}
              </span>
              <div className="flex-1">
                <p className={done ? "text-sm font-medium" : "text-sm text-muted-foreground"}>{STEP_LABEL[step]}</p>
                {ev?.message && <p className="text-xs text-muted-foreground">{ev.message}</p>}
                {tx && (
                  <a
                    href={`https://explorer.solana.com/tx/${tx}?cluster=devnet`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-xs font-mono text-primary underline-offset-4 hover:underline"
                  >
                    View on Solana Explorer · {tx.slice(0, 10)}...{tx.slice(-6)}
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {errored && (
        <p className="mt-4 rounded border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          {events.find((e) => e.step === "error")?.message ?? "Demo loop failed."}
        </p>
      )}

      {!running && events.length === 0 && (
        <p className="mt-4 text-xs text-muted-foreground">
          The demo loop creates a new task with a $0.25 bounty, runs a worker through claim and signed submission,
          then triggers the on-chain release. Click any signature above to verify on Solana Explorer.
        </p>
      )}
    </div>
  );
}

// Returns the step that should be in-flight when we are still on `next`.
function priorTo(step: string): string {
  const idx = STEP_ORDER.indexOf(step);
  return idx <= 0 ? "" : STEP_ORDER[idx - 1];
}
