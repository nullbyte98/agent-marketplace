"use client";

import { useEffect, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { SiteHeader } from "@/components/site-header";
import { TaskCard } from "@/components/task-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { USDC_MINT, USDC_DECIMALS } from "@/lib/constants";

export default function Dashboard() {
  const { publicKey, connected } = useWallet();
  const { connection } = useConnection();
  const [claimed, setClaimed] = useState<any[]>([]);
  const [submitted, setSubmitted] = useState<any[]>([]);
  const [paid, setPaid] = useState<any[]>([]);
  const [balance, setBalance] = useState<number>(0);

  useEffect(() => {
    if (!publicKey) return;
    (async () => {
      try {
        const ata = await getAssociatedTokenAddress(USDC_MINT, publicKey, true);
        const acc = await getAccount(connection, ata);
        setBalance(Number(acc.amount) / 10 ** USDC_DECIMALS);
      } catch { setBalance(0); }
    })();
    (async () => {
      const all = await fetch("/api/tasks?status=").then((r) => r.json());
      const mine = (all.tasks ?? []).filter((t: any) => t.claimed_by_wallet === publicKey.toBase58());
      setClaimed(mine.filter((t: any) => t.status === "claimed"));
      setSubmitted(mine.filter((t: any) => t.status === "submitted"));
      setPaid(mine.filter((t: any) => t.status === "paid"));
    })();
  }, [publicKey, connection]);

  return (
    <main className="min-h-screen bg-background">
      <SiteHeader />
      <div className="container mx-auto max-w-6xl px-6 py-10">
        <h1 className="mb-6 text-3xl font-bold">Dashboard</h1>
        {!connected ? (
          <p className="text-sm text-muted-foreground">Connect Phantom to view your tasks and earnings.</p>
        ) : (
          <>
            <div className="mb-8 grid gap-4 sm:grid-cols-3">
              <Card><CardHeader><CardTitle className="text-base">USDC balance</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">${balance.toFixed(2)}</p></CardContent></Card>
              <Card><CardHeader><CardTitle className="text-base">Active claim</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{claimed.length}</p></CardContent></Card>
              <Card><CardHeader><CardTitle className="text-base">Paid tasks</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{paid.length}</p></CardContent></Card>
            </div>
            <Section title="Currently claimed" tasks={claimed} />
            <Section title="Submitted, awaiting review" tasks={submitted} />
            <Section title="Paid" tasks={paid} />
          </>
        )}
      </div>
    </main>
  );
}

function Section({ title, tasks }: { title: string; tasks: any[] }) {
  if (tasks.length === 0) return null;
  return (
    <section className="mb-10">
      <h2 className="mb-3 text-xl font-semibold">{title}</h2>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {tasks.map((t) => <TaskCard key={t.id} task={t} />)}
      </div>
    </section>
  );
}
