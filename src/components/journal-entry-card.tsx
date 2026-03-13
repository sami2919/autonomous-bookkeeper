"use client";

import { useState } from "react";
import { ChevronRight, Check, X } from "lucide-react";
import { formatCurrency } from "@/lib/format";

export type LineItem = {
  id: number;
  entryId: number;
  accountId: number;
  accountCode: string | null;
  accountName: string | null;
  debitCents: number;
  creditCents: number;
};

export type JournalEntry = {
  id: number;
  date: string;
  description: string;
  status: "draft" | "posted" | "reversed";
  transactionId: number | null;
  createdAt: string;
  updatedAt: string;
  lineItems: LineItem[];
};


function StatusBadge({ status }: { status: JournalEntry["status"] }) {
  const variants: Record<JournalEntry["status"], string> = {
    posted: "bg-emerald-50 text-emerald-700",
    draft: "bg-slate-100 text-slate-500",
    reversed: "bg-red-50 text-red-600",
  };
  const labels: Record<JournalEntry["status"], string> = {
    posted: "Posted",
    draft: "Draft",
    reversed: "Reversed",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${variants[status]}`}
    >
      {labels[status]}
    </span>
  );
}

type Props = {
  entry: JournalEntry;
};

export default function JournalEntryCard({ entry }: Props) {
  const [expanded, setExpanded] = useState(false);

  const totalDebitCents = entry.lineItems.reduce(
    (sum, li) => sum + li.debitCents,
    0
  );
  const totalCreditCents = entry.lineItems.reduce(
    (sum, li) => sum + li.creditCents,
    0
  );
  const isBalanced = totalDebitCents === totalCreditCents;

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        aria-controls={`entry-detail-${entry.id}`}
        className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-slate-50 transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
      >
        <ChevronRight
          size={16}
          className={`shrink-0 text-slate-400 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
          aria-hidden="true"
        />

        <span className="w-24 shrink-0 text-sm font-mono tabular-nums text-slate-500">
          {entry.date}
        </span>

        <span className="flex-1 text-sm font-medium text-slate-900 truncate">
          {entry.description}
        </span>

        <StatusBadge status={entry.status} />

        <span className="w-28 shrink-0 text-right text-sm font-mono font-medium tabular-nums text-slate-700">
          {formatCurrency(totalDebitCents)}
        </span>
      </button>

      {expanded && (
        <div
          id={`entry-detail-${entry.id}`}
          className="border-t border-slate-100 px-5 pb-5 pt-4"
        >
          <table className="w-full text-sm" aria-label="Journal line items">
            <thead>
              <tr className="text-xs font-semibold uppercase tracking-wide text-slate-400 border-b border-slate-100">
                <th scope="col" className="pb-2 text-left">Account</th>
                <th scope="col" className="pb-2 text-left text-slate-400">Code</th>
                <th scope="col" className="pb-2 text-right">Debit</th>
                <th scope="col" className="pb-2 text-right">Credit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {entry.lineItems.map((li) => (
                <tr key={li.id}>
                  <td className="py-2 text-slate-800">
                    {li.accountName ?? <span className="text-slate-300">Unknown</span>}
                  </td>
                  <td className="py-2 text-xs text-slate-400 font-mono">
                    {li.accountCode ?? "—"}
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums text-slate-700">
                    {li.debitCents > 0 ? formatCurrency(li.debitCents) : "—"}
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums text-slate-700">
                    {li.creditCents > 0 ? formatCurrency(li.creditCents) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 font-medium">
                <td colSpan={2} className="pt-2 text-xs text-slate-400 uppercase tracking-wide">
                  Totals
                </td>
                <td className="pt-2 text-right font-mono tabular-nums text-slate-800">
                  {formatCurrency(totalDebitCents)}
                </td>
                <td className="pt-2 text-right font-mono tabular-nums text-slate-800">
                  {formatCurrency(totalCreditCents)}
                </td>
              </tr>
            </tfoot>
          </table>

          <div className="mt-3 flex items-center gap-2">
            {isBalanced ? (
              <>
                <Check size={14} className="text-emerald-500" aria-hidden="true" />
                <span className="text-xs text-emerald-600 font-medium">Balanced</span>
              </>
            ) : (
              <>
                <X size={14} className="text-red-500" aria-hidden="true" />
                <span className="text-xs text-red-600 font-medium">
                  Unbalanced — debits and credits do not match
                </span>
              </>
            )}

            {entry.transactionId !== null && (
              <a
                href={`/transactions`}
                className="ml-auto text-xs text-blue-600 hover:text-blue-800 hover:underline cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              >
                View source transaction #{entry.transactionId}
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
