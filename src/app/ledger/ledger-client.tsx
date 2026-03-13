"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import JournalEntryCard, {
  type JournalEntry,
} from "@/components/journal-entry-card";
import { formatCurrency } from "@/lib/format";

type StatusFilter = "all" | "draft" | "posted" | "reversed";

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold font-mono tabular-nums text-slate-900">{value}</p>
    </div>
  );
}

const STATUS_TABS: { label: string; value: StatusFilter }[] = [
  { label: "All", value: "all" },
  { label: "Draft", value: "draft" },
  { label: "Posted", value: "posted" },
  { label: "Reversed", value: "reversed" },
];

type Props = {
  entries: JournalEntry[];
};

export default function LedgerClient({ entries }: Props) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [refreshing, setRefreshing] = useState(false);

  const { filtered, tabCounts, totalDebitCents, totalCreditCents } =
    useMemo(() => {
      let debit = 0;
      let credit = 0;
      const counts: Record<StatusFilter, number> = {
        all: entries.length,
        draft: 0,
        posted: 0,
        reversed: 0,
      };
      const filteredList: JournalEntry[] = [];

      for (const e of entries) {
        counts[e.status]++;
        for (const li of e.lineItems) {
          debit += li.debitCents;
          credit += li.creditCents;
        }
        if (statusFilter === "all" || e.status === statusFilter) {
          filteredList.push(e);
        }
      }

      return {
        filtered: filteredList,
        tabCounts: counts,
        totalDebitCents: debit,
        totalCreditCents: credit,
      };
    }, [entries, statusFilter]);

  const hasEntries = entries.length > 0;

  function handleRefresh() {
    setRefreshing(true);
    router.refresh();
    setTimeout(() => setRefreshing(false), 500);
  }

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Ledger</h1>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} aria-hidden="true" />
          {refreshing ? "Loading\u2026" : "Refresh"}
        </button>
      </div>

      {hasEntries && (
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="All Entries" value={entries.length} />
          <StatCard label="Total Debits" value={formatCurrency(totalDebitCents)} />
          <StatCard label="Total Credits" value={formatCurrency(totalCreditCents)} />
        </div>
      )}

      {hasEntries && (
        <div
          role="tablist"
          aria-label="Filter by status"
          className="flex gap-1 rounded-lg bg-slate-100 p-1 w-fit"
        >
          {STATUS_TABS.map((tab) => (
              <button
                key={tab.value}
                role="tab"
                aria-selected={statusFilter === tab.value}
                onClick={() => setStatusFilter(tab.value)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
                  statusFilter === tab.value
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {tab.label}
                <span className="ml-1.5 text-xs text-slate-400">{tabCounts[tab.value]}</span>
              </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-400">
          {entries.length === 0
            ? "No journal entries yet. Process some transactions to generate entries."
            : `No ${statusFilter} entries.`}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((entry) => (
            <JournalEntryCard key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
