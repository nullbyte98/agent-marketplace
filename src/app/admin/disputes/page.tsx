"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import { SiteHeader } from "@/components/site-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function AdminDisputes() {
  const { publicKey, signMessage, connected } = useWallet();
  const [disputes, setDisputes] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function load() {
    const r = await fetch("/api/admin/disputes");
    const d = await r.json();
    setDisputes(d.disputes ?? []);
  }
  useEffect(() => { load(); }, []);

  async function resolve(disputeId: string, resolution: "release" | "refund") {
    if (!publicKey || !signMessage) return;
    setBusy(disputeId); setFeedback(null);
    const message = `agent-marketplace.admin-resolve\ndispute:${disputeId}`;
    const sigBytes = await signMessage(new TextEncoder().encode(message));
    const signature = bs58.encode(sigBytes);
    const r = await fetch(`/api/admin/disputes/${disputeId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ admin_wallet: publicKey.toBase58(), signature, resolution }),
    });
    const d = await r.json();
    setBusy(null);
    setFeedback(r.ok ? `Resolved as ${d.resolution}. Tx: ${d.tx}` : d.error);
    load();
  }

  return (
    <main className="min-h-screen bg-background">
      <SiteHeader />
      <div className="container mx-auto max-w-4xl px-6 py-10">
        <h1 className="mb-2 text-3xl font-bold">Admin disputes</h1>
        <p className="mb-6 text-sm text-muted-foreground">Only the configured admin wallet can resolve. You will be asked to sign a message to authorise each action.</p>

        {!connected && <p className="text-sm text-muted-foreground">Connect Phantom with the admin wallet to resolve disputes.</p>}
        {feedback && <p className="mb-4 rounded border border-border bg-card p-3 text-sm">{feedback}</p>}

        {disputes.length === 0 ? <p className="text-sm text-muted-foreground">No open disputes.</p> : (
          <div className="space-y-4">
            {disputes.map((d) => (
              <Card key={d.id}>
                <CardHeader>
                  <CardTitle className="text-lg">{d.task.title}</CardTitle>
                  <p className="text-xs text-muted-foreground">${d.task.bountyUsdc.toFixed(2)} USDC · raised by {d.raisedBy}</p>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p><strong>Reason:</strong> {d.reason}</p>
                  <p className="text-xs">Agent: <code>{d.task.agent.walletAddress}</code></p>
                  <p className="text-xs">Worker: <code>{d.task.claimedByWallet}</code></p>
                  {d.task.submissions?.[0] && (
                    <details className="rounded bg-muted p-2 text-xs">
                      <summary className="cursor-pointer">Submission</summary>
                      <pre className="mt-2 overflow-x-auto">{d.task.submissions[0].submissionData}</pre>
                    </details>
                  )}
                  <div className="flex gap-2">
                    <Button size="sm" disabled={busy === d.id} onClick={() => resolve(d.id, "release")}>Release to worker</Button>
                    <Button size="sm" variant="outline" disabled={busy === d.id} onClick={() => resolve(d.id, "refund")}>Refund to agent</Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
