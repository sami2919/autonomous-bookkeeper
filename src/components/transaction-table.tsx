"use client";

import { useState, Fragment } from "react";
import { ChevronRight } from "lucide-react";
import ConfidenceBadge from "./confidence-badge";
import { formatCurrency } from "@/lib/format";

export type TransactionRow = {
  id: number;
  date: string;
  merchantName: string | null;
  description: string;
  amountCents: number;
  status: "pending" | "categorized" | "needs_clarification" | "posted";
  categoryConfidence: number | null;
  accountName: string | null;
  accountCode: string | null;
  agentReasoning: string | null;
};


function StatusBadge({ status }: { status: TransactionRow["status"] }) {
  const variants: Record<TransactionRow["status"], string> = {
    posted: "bg-emerald-50 text-emerald-700",
    categorized: "bg-blue-50 text-blue-700",
    needs_clarification: "bg-amber-50 text-amber-700",
    pending: "bg-slate-100 text-slate-500",
  };

  const labels: Record<TransactionRow["status"], string> = {
    posted: "Posted",
    categorized: "Categorized",
    needs_clarification: "Needs Clarification",
    pending: "Pending",
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
  transactions: TransactionRow[];
};

export default function TransactionTable({ transactions }: Props) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (transactions.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-slate-400">
        No transactions found.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
            <th scope="col" className="px-4 py-3">Date</th>
            <th scope="col" className="px-4 py-3">Merchant</th>
            <th scope="col" className="px-4 py-3 text-right">Amount</th>
            <th scope="col" className="px-4 py-3">Status</th>
            <th scope="col" className="px-4 py-3">Category</th>
            <th scope="col" className="px-4 py-3">Confidence</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {transactions.map((tx) => {
            const isExpanded = expandedId === tx.id;
            // positive cents = expense (money out) = red
            // negative cents = income (money in) = green
            const isExpense = tx.amountCents > 0;

            return (
              <Fragment key={tx.id}>
                <tr
                  tabIndex={0}
                  role="button"
                  onClick={() => setExpandedId(isExpanded ? null : tx.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setExpandedId(isExpanded ? null : tx.id);
                    }
                  }}
                  className="cursor-pointer hover:bg-slate-50 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
                  aria-expanded={isExpanded}
                  aria-controls={`reasoning-${tx.id}`}
                >
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-sm tabular-nums text-slate-500">
                    {tx.date}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {tx.merchantName ?? tx.description}
                  </td>
                  <td
                    className={`whitespace-nowrap px-4 py-3 text-right font-mono tabular-nums font-medium ${
                      isExpense ? "text-red-600" : "text-emerald-600"
                    }`}
                  >
                    {isExpense ? "−" : "+"}
                    {formatCurrency(tx.amountCents)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={tx.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {tx.accountName ? (
                      <span title={tx.accountCode ?? undefined}>
                        {tx.accountName}
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <ConfidenceBadge confidence={tx.categoryConfidence} />
                  </td>
                </tr>
                {isExpanded && tx.agentReasoning && (
                  <tr id={`reasoning-${tx.id}`} className="bg-blue-50">
                    <td colSpan={6} className="px-4 py-3">
                      <div className="flex items-start gap-2">
                        <ChevronRight size={14} className="mt-0.5 shrink-0 text-blue-400" aria-hidden="true" />
                        <div>
                          <p className="text-xs font-medium text-blue-600 mb-1">
                            Agent Reasoning
                          </p>
                          <p className="text-sm text-slate-700 leading-relaxed">
                            {tx.agentReasoning}
                          </p>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
