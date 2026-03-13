"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Play, Database } from "lucide-react";
import TransactionTable, {
  type TransactionRow,
} from "@/components/transaction-table";
import AgentActivityLog from "@/components/agent-activity-log";
import type { ActivityEvent } from "@/lib/types";

type Stats = {
  total: number;
  pending: number;
  posted: number;
  needs_clarification: number;
};

function computeStats(txs: TransactionRow[]): Stats {
  return txs.reduce(
    (acc, tx) => ({
      total: acc.total + 1,
      pending: acc.pending + (tx.status === "pending" ? 1 : 0),
      posted: acc.posted + (tx.status === "posted" ? 1 : 0),
      needs_clarification:
        acc.needs_clarification + (tx.status === "needs_clarification" ? 1 : 0),
    }),
    { total: 0, pending: 0, posted: 0, needs_clarification: 0 }
  );
}

const STAT_ACCENTS: Record<string, { border: string; label: string }> = {
  total: { border: "border-l-slate-300", label: "Total" },
  pending: { border: "border-l-amber-400", label: "Pending" },
  posted: { border: "border-l-emerald-400", label: "Posted" },
  needs_clarification: { border: "border-l-red-400", label: "Needs Clarification" },
};

function StatCard({ statKey, value }: { statKey: string; value: number }) {
  const accent = STAT_ACCENTS[statKey];
  return (
    <div className={`rounded-xl border border-slate-200 border-l-4 ${accent.border} bg-white px-5 py-4`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {accent.label}
      </p>
      <p className="mt-1 text-2xl font-semibold font-mono tabular-nums text-slate-900">{value}</p>
    </div>
  );
}

type Props = {
  initialTransactions: TransactionRow[];
};

export default function TransactionsClient({ initialTransactions }: Props) {
  const router = useRouter();
  const [transactions, setTransactions] = useState<TransactionRow[]>(initialTransactions);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);

  useEffect(() => {
    setTransactions(initialTransactions);
  }, [initialTransactions]);

  async function handleSeed() {
    setSeeding(true);
    try {
      const res = await fetch("/api/transactions", { method: "POST" });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Seed failed");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Seed failed");
    } finally {
      setSeeding(false);
    }
  }

  async function handleProcess() {
    setProcessing(true);
    setActivityEvents([]);

    try {
      const response = await fetch('/api/transactions/process/stream', { method: 'POST' });

      if (!response.ok) {
        const json = await response.json();
        throw new Error(json.error ?? 'Processing failed');
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);

          if (data === '[DONE]') {
            router.refresh();
            continue;
          }

          try {
            const event = JSON.parse(data) as ActivityEvent;
            setActivityEvents(prev => [...prev, event]);
          } catch {
            // Skip malformed events
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Processing failed');
    } finally {
      setProcessing(false);
    }
  }

  const stats = computeStats(transactions);
  const hasTransactions = transactions.length > 0;

  return (
    <>
    <AgentActivityLog events={activityEvents} active={processing} />
    <div className="flex flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Transactions</h1>
        <div className="flex items-center gap-3">
          {!hasTransactions && (
            <button
              onClick={handleSeed}
              disabled={seeding}
              className="flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            >
              <Database size={14} aria-hidden="true" />
              {seeding ? "Seeding\u2026" : "Seed Data"}
            </button>
          )}
          {hasTransactions && (
            <button
              onClick={handleProcess}
              disabled={processing}
              className="flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            >
              <Play size={14} aria-hidden="true" />
              {processing ? "Processing\u2026" : "Process All"}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {hasTransactions && (
        <div className="grid grid-cols-4 gap-4">
          <StatCard statKey="total" value={stats.total} />
          <StatCard statKey="pending" value={stats.pending} />
          <StatCard statKey="posted" value={stats.posted} />
          <StatCard statKey="needs_clarification" value={stats.needs_clarification} />
        </div>
      )}

      <TransactionTable transactions={transactions} />
    </div>
    </>
  );
}
