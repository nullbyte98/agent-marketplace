"use client";

import { useEffect, useState } from "react";

interface ActivityItem {
  id: string;
  title: string;
  status: string;
  bounty_usdc: number;
  agent_label: string;
  worker_wallet: string | null;
  payout_tx: string | null;
  refund_tx: string | null;
  created_at: string;
}

interface Stats {
  total_paid_tasks: number;
  total_usdc_paid: number;
  total_tasks: number;
  total_workers: number;
}

export function LiveActivityFeed() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const r = await fetch("/api/activity", { cache: "no-store" });
      const d = await r.json();
      setItems(d.items ?? []);
      setStats(d.stats ?? null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const i = setInterval(load, 15000);
    return () => clearInterval(i);
  }, []);

  return (
    <div>
      {stats && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="USDC paid out" value={`$${stats.total_usdc_paid.toFixed(2)}`} />
          <Stat label="Tasks completed" value={stats.total_paid_tasks.toString()} />
          <Stat label="Tasks created" value={stats.total_tasks.toString()} />
          <Stat label="Unique workers" value={stats.total_workers.toString()} />
        </div>
      )}

      <div className="rounded-lg border border-border bg-card">
        {loading ? (
          <p className="p-6 text-sm text-muted-foreground">Loading recent activity...</p>
        ) : items.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No completed tasks yet. Run the live demo above and refresh.</p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((it) => {
              const tx = it.payout_tx ?? it.refund_tx;
              const verb = it.status === "paid" ? "paid" : "refunded";
              const wallet = it.worker_wallet ? `${it.worker_wallet.slice(0, 4)}...${it.worker_wallet.slice(-4)}` : "—";
              return (
                <li key={it.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium">{it.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {it.agent_label} {verb} {wallet}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="font-medium">${it.bounty_usdc.toFixed(2)}</span>
                    {tx && (
                      <a
                        href={`https://explorer.solana.com/tx/${tx}?cluster=devnet`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-primary underline-offset-4 hover:underline"
                      >
                        {tx.slice(0, 8)}...
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}
