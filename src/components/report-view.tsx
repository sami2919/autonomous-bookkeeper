"use client";

import { type ReactNode } from "react";

export type Tab = { label: string; value: string };

type TabBarProps = {
  tabs: Tab[];
  active: string;
  onChange: (value: string) => void;
};

export function TabBar({ tabs, active, onChange }: TabBarProps) {
  return (
    <div
      role="tablist"
      aria-label="Report type"
      className="flex gap-1 rounded-lg bg-slate-100 p-1 w-fit"
    >
      {tabs.map((tab) => (
        <button
          key={tab.value}
          role="tab"
          aria-selected={active === tab.value}
          onClick={() => onChange(tab.value)}
          className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
            active === tab.value
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

type LineRow = { code: string; name: string; amount: string };

function AccountLine({ row, indent }: { row: LineRow; indent?: boolean }) {
  return (
    <tr className="hover:bg-slate-50 transition-colors duration-150">
      <td
        className={`py-2 text-sm font-mono tabular-nums text-slate-400 ${indent ? "pl-8" : "pl-4"}`}
      >
        {row.code}
      </td>
      <td className={`py-2 text-sm text-slate-800 ${indent ? "pl-2" : ""}`}>
        {row.name}
      </td>
      <td className="py-2 text-sm text-right font-mono tabular-nums text-slate-800 pr-4">
        {row.amount}
      </td>
    </tr>
  );
}

type SectionProps = {
  heading: string;
  lines: LineRow[];
  total: string;
  totalLabel?: string;
};

export function ReportSection({
  heading,
  lines,
  total,
  totalLabel,
}: SectionProps) {
  return (
    <>
      <tr>
        <td
          colSpan={3}
          className="pt-5 pb-1 pl-4 text-xs font-semibold uppercase tracking-wider text-slate-400"
        >
          {heading}
        </td>
      </tr>
      {lines.map((row) => (
        <AccountLine key={`${heading}-${row.code}`} row={row} indent />
      ))}
      <tr className="border-t border-slate-200">
        <td className="py-2 pl-4 text-sm font-mono tabular-nums text-slate-400" />
        <td className="py-2 text-sm font-semibold text-slate-700">
          {totalLabel ?? `Total ${heading}`}
        </td>
        <td className="py-2 text-sm font-semibold text-right font-mono tabular-nums text-slate-900 pr-4">
          {total}
        </td>
      </tr>
    </>
  );
}

type SummaryLineProps = {
  label: string;
  amount: string;
  highlight?: boolean;
};

export function SummaryLine({ label, amount, highlight }: SummaryLineProps) {
  return (
    <tr
      className={highlight ? "bg-slate-900 text-white" : "bg-slate-50"}
    >
      <td className="py-3 pl-4 font-mono tabular-nums text-sm" />
      <td
        className={`py-3 text-sm font-bold ${highlight ? "text-white" : "text-slate-800"}`}
      >
        {label}
      </td>
      <td
        className={`py-3 text-sm font-bold text-right font-mono tabular-nums pr-4 ${highlight ? "text-white" : "text-slate-800"}`}
      >
        {amount}
      </td>
    </tr>
  );
}

type ReportTableProps = {
  headers: string[];
  children: ReactNode;
};

export function ReportTable({ headers, children }: ReportTableProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            {headers.map((h, i) => (
              <th
                key={h}
                scope="col"
                className={`py-3 text-xs font-semibold uppercase tracking-wider text-slate-400 ${
                  i === 0
                    ? "pl-4 text-left w-20"
                    : i === headers.length - 1
                      ? "pr-4 text-right"
                      : "text-left"
                }`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

type TotalsRowProps = {
  label: string;
  values: string[];
  balanced?: boolean;
};

export function TotalsRow({ label, values, balanced }: TotalsRowProps) {
  return (
    <tr className="border-t-2 border-slate-900 bg-slate-50">
      <td className="py-3 pl-4 font-mono tabular-nums text-sm font-bold text-slate-900" />
      <td className="py-3 text-sm font-bold text-slate-900">
        {label}
        {balanced !== undefined && (
          <span
            className={`ml-2 rounded-full px-2.5 py-0.5 text-xs font-medium ${
              balanced
                ? "bg-emerald-50 text-emerald-700"
                : "bg-red-50 text-red-700"
            }`}
          >
            {balanced ? "Balanced" : "Unbalanced"}
          </span>
        )}
      </td>
      {values.map((v, i) => (
        <td
          key={i}
          className="py-3 text-sm font-bold text-right font-mono tabular-nums text-slate-900 pr-4"
        >
          {v}
        </td>
      ))}
    </tr>
  );
}

type EquationBadgeProps = {
  left: string;
  right: string;
  isBalanced: boolean;
};

export function EquationBadge({ left, right, isBalanced }: EquationBadgeProps) {
  return (
    <div
      aria-label={
        isBalanced
          ? "Accounting equation is balanced"
          : "Accounting equation is unbalanced"
      }
      className={`flex items-center gap-3 rounded-xl border px-5 py-4 text-sm font-mono ${
        isBalanced
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-red-200 bg-red-50 text-red-800"
      }`}
    >
      <span className="font-bold">A = L + E</span>
      <span className="text-slate-400">|</span>
      <span>Assets {left}</span>
      <span>=</span>
      <span>Liabilities + Equity {right}</span>
      <span
        className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-semibold ${
          isBalanced
            ? "bg-emerald-200 text-emerald-800"
            : "bg-red-200 text-red-800"
        }`}
      >
        {isBalanced ? "Balanced" : "Unbalanced"}
      </span>
    </div>
  );
}
