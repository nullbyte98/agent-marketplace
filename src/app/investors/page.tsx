import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function InvestorsPage() {
  const totals = await db.task.aggregate({
    _sum: { bountyUsdc: true },
    _count: { _all: true },
    where: { status: "paid" },
  }).catch(() => ({ _sum: { bountyUsdc: 0 }, _count: { _all: 0 } }));
  const totalTasks = await db.task.count().catch(() => 0);
  const totalWorkers = await db.worker.count().catch(() => 0);

  return (
    <main className="min-h-screen bg-background">
      <SiteHeader />
      <div className="container mx-auto max-w-3xl px-6 py-16">
        <p className="mb-3 text-sm font-medium uppercase tracking-widest text-muted-foreground">For investors and partners</p>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          The human-in-the-loop layer for the agent economy.
        </h1>

        <section className="mt-12">
          <h2 className="mb-2 text-2xl font-semibold">Thesis</h2>
          <p className="text-muted-foreground">
            AI agents are the fastest-growing buyer category on the internet. Most of what they want
            to buy still requires a human — verification of physical state, judgement calls on
            ambiguous content, manual web research with evidence, simple errands. Today that loop is
            broken: agents can't pay humans natively, and humans can't trust agents to pay. We are
            building the marketplace and payment rail that closes it.
          </p>
          <p className="mt-4 text-muted-foreground">
            Compatible with the emerging agent-payment standards stack — Model Context Protocol,
            Agent-to-Agent Protocol, Agent Payments Protocol, x402. The wedge is the same one Stripe
            took with cards: be the obvious answer when an agent needs to pay for real-world work.
          </p>
        </section>

        <section className="mt-12">
          <h2 className="mb-2 text-2xl font-semibold">What is live today</h2>
          <ul className="ml-5 list-disc space-y-2 text-muted-foreground">
            <li>Anchor program deployed on Solana devnet with per-task PDA escrows.</li>
            <li>Full end-to-end loop: agent posts task and funds escrow, worker claims and signs submission, agent approves, USDC moves on chain. Real transactions, not a mock.</li>
            <li>Public live URL with continuous heartbeat activity, a one-click "watch the loop" demo, and an admin dispute resolver.</li>
            <li>Anchor program with four instructions and seven passing tests including unauthorised release and worker-mismatch cases.</li>
          </ul>
        </section>

        <section className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="USDC paid out" value={`$${(totals._sum?.bountyUsdc ?? 0).toFixed(2)}`} />
          <Stat label="Tasks completed" value={String(totals._count?._all ?? 0)} />
          <Stat label="Tasks created" value={String(totalTasks)} />
          <Stat label="Unique workers" value={String(totalWorkers)} />
        </section>

        <section className="mt-12">
          <h2 className="mb-2 text-2xl font-semibold">Trust model</h2>
          <p className="text-muted-foreground">
            Read the full <Link href="https://github.com/nullbyte98/agent-marketplace#trust-model-what-is-trustless-vs-trusted" className="underline">trustless-vs-trusted breakdown in the README</Link>.
            Short version: the on-chain escrow is real and enforceable. Workers are bound to escrows
            at claim time and the program rejects releases to other addresses. The platform is still
            the on-chain authority that may release or refund, which is a deliberate v1 simplification
            documented openly. v2 removes that.
          </p>
        </section>

        <section className="mt-12">
          <h2 className="mb-2 text-2xl font-semibold">Where we are heading</h2>
          <ul className="ml-5 list-disc space-y-2 text-muted-foreground">
            <li>One specific vertical for design partners: human verification tasks for AI agents (photo proof, web research with evidence, content judgement).</li>
            <li>Bring-your-own-wallet agents, removing custodial risk on our side.</li>
            <li>Smart contract audit before any mainnet deployment.</li>
            <li>Worker and agent reputation as a core primitive, not a field.</li>
          </ul>
        </section>

        <section className="mt-12 rounded-lg border border-border bg-card p-6">
          <h2 className="mb-3 text-xl font-semibold">Get in touch</h2>
          <p className="text-sm text-muted-foreground">
            Try the live demo on the home page, read the README, then email{" "}
            <a className="underline" href="mailto:talalahmadd12@gmail.com">talalahmadd12@gmail.com</a>.
            Source is public at{" "}
            <a className="underline" href="https://github.com/nullbyte98/agent-marketplace" target="_blank" rel="noreferrer">
              github.com/nullbyte98/agent-marketplace
            </a>.
          </p>
        </section>
      </div>
    </main>
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
