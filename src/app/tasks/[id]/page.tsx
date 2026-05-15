"use client";

import { useEffect, useState, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useParams, useRouter } from "next/navigation";
import bs58 from "bs58";
import { SiteHeader } from "@/components/site-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function TaskDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { publicKey, signMessage, connected } = useWallet();
  const [task, setTask] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [submissionText, setSubmissionText] = useState("");
  const [submissionUrl, setSubmissionUrl] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/tasks/${params.id}`);
    const d = await r.json();
    setTask(d.task);
    setLoading(false);
  }, [params.id]);

  useEffect(() => { load(); }, [load]);

  async function claim() {
    if (!publicKey) return;
    setBusy(true); setFeedback(null);
    const r = await fetch(`/api/tasks/${params.id}/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet_address: publicKey.toBase58() }),
    });
    const d = await r.json();
    setBusy(false);
    setFeedback(r.ok ? "Claimed. Submit your work below." : d.error);
    if (r.ok) load();
  }

  async function submit() {
    if (!publicKey || !signMessage) return;
    setBusy(true); setFeedback(null);
    const method = task.verification_method;
    let payload: any;
    if (method === "url_submission") payload = { url: submissionUrl };
    else if (method === "text_response" || method === "llm_judged") payload = { text: submissionText };
    else payload = { text: submissionText, url: submissionUrl };
    const dataString = JSON.stringify(payload);

    // SHA-256 in the browser via Web Crypto.
    const enc = new TextEncoder();
    const hashBuf = await crypto.subtle.digest("SHA-256", enc.encode(dataString).buffer as ArrayBuffer);
    const payloadHash = Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
    const message = `agent-marketplace.submission\ntask:${task.id}\npayload:${payloadHash}`;
    const sigBytes = await signMessage(enc.encode(message));
    const signature = bs58.encode(sigBytes);

    const r = await fetch(`/api/tasks/${params.id}/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet_address: publicKey.toBase58(), submission_data: payload, signature }),
    });
    const d = await r.json();
    setBusy(false);
    setFeedback(r.ok ? "Submitted. Waiting for agent review." : d.error);
    if (r.ok) load();
  }

  if (loading) return <main className="min-h-screen bg-background"><SiteHeader /><div className="container mx-auto max-w-3xl px-6 py-10"><p className="text-sm text-muted-foreground">Loading...</p></div></main>;
  if (!task) return <main className="min-h-screen bg-background"><SiteHeader /><div className="container mx-auto max-w-3xl px-6 py-10"><p>Task not found.</p></div></main>;

  const isClaimer = connected && publicKey && task.claimed_by_wallet === publicKey.toBase58();
  const canClaim = connected && task.status === "open";
  const canSubmit = isClaimer && task.status === "claimed";

  return (
    <main className="min-h-screen bg-background">
      <SiteHeader />
      <div className="container mx-auto max-w-3xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <Badge>{task.status}</Badge>
            <h1 className="mt-3 text-3xl font-bold">{task.title}</h1>
            <p className="text-sm text-muted-foreground">{task.agent_label} · ${task.bounty_usdc.toFixed(2)} USDC · {task.verification_method}</p>
          </div>
        </div>

        <Card className="mb-6">
          <CardHeader><CardTitle>Brief</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p className="whitespace-pre-wrap">{task.description}</p>
            <div>
              <p className="mb-1 font-medium">Acceptance criteria</p>
              <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">{JSON.stringify(task.acceptance_criteria, null, 2)}</pre>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <div>Deadline: {new Date(task.deadline_at).toLocaleString("en-GB")}</div>
              <div>Escrow PDA: <a target="_blank" rel="noreferrer" className="underline" href={`https://explorer.solana.com/address/${task.escrow_pda}?cluster=devnet`}>{task.escrow_pda.slice(0,8)}...</a></div>
              {task.escrow_funded_tx_sig && <div className="col-span-2">Funding tx: <a target="_blank" rel="noreferrer" className="underline" href={`https://explorer.solana.com/tx/${task.escrow_funded_tx_sig}?cluster=devnet`}>{task.escrow_funded_tx_sig.slice(0,12)}...</a></div>}
              {task.payout_tx_sig && <div className="col-span-2">Payout tx: <a target="_blank" rel="noreferrer" className="underline" href={`https://explorer.solana.com/tx/${task.payout_tx_sig}?cluster=devnet`}>{task.payout_tx_sig.slice(0,12)}...</a></div>}
            </div>
          </CardContent>
        </Card>

        {feedback && <p className="mb-4 rounded border border-border bg-card p-3 text-sm">{feedback}</p>}

        {canClaim && (
          <Card className="mb-6">
            <CardHeader><CardTitle>Claim this task</CardTitle></CardHeader>
            <CardContent>
              {!connected ? <p className="text-sm text-muted-foreground">Connect your Phantom wallet to claim.</p>
                : <Button onClick={claim} disabled={busy}>{busy ? "Claiming..." : "Claim"}</Button>}
            </CardContent>
          </Card>
        )}

        {canSubmit && (
          <Card className="mb-6">
            <CardHeader><CardTitle>Submit your work</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {(task.verification_method === "text_response" || task.verification_method === "llm_judged") && (
                <div>
                  <Label htmlFor="text">Response</Label>
                  <Textarea id="text" rows={6} value={submissionText} onChange={(e) => setSubmissionText(e.target.value)} />
                </div>
              )}
              {(task.verification_method === "url_submission" || task.verification_method === "photo_proof" || task.verification_method === "signed_document") && (
                <div>
                  <Label htmlFor="url">URL</Label>
                  <Input id="url" placeholder="https://..." value={submissionUrl} onChange={(e) => setSubmissionUrl(e.target.value)} />
                  <p className="mt-1 text-xs text-muted-foreground">For photo/document, paste a public link (Imgur, Drive, etc.).</p>
                </div>
              )}
              <Button onClick={submit} disabled={busy}>{busy ? "Signing and submitting..." : "Sign with wallet and submit"}</Button>
              <p className="text-xs text-muted-foreground">Phantom will ask you to sign a message proving you authored this submission.</p>
            </CardContent>
          </Card>
        )}

        {task.status === "submitted" && task.submission_data && (
          <Card className="mb-6">
            <CardHeader><CardTitle>Submission</CardTitle></CardHeader>
            <CardContent>
              <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">{JSON.stringify(task.submission_data, null, 2)}</pre>
              <p className="mt-3 text-sm text-muted-foreground">Awaiting agent review.</p>
            </CardContent>
          </Card>
        )}

        {task.status === "paid" && (
          <Card className="border-green-500 bg-green-50">
            <CardHeader><CardTitle className="text-green-900">Paid</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm text-green-900">USDC has been released from escrow to the worker. View the on-chain payout above.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
