"use client";

import { useState, useEffect, useCallback } from "react";
import {
  TabBar,
  ReportTable,
  ReportSection,
  SummaryLine,
  TotalsRow,
  EquationBadge,
  type Tab,
} from "@/components/report-view";
import type {
  TrialBalanceReport,
  IncomeStatementReport,
  BalanceSheetReport,
} from "@/agents/reporting";

type ApiResponse<T> = { data: T | null; error?: string };

type ReportTab = "trial-balance" | "income-statement" | "balance-sheet";

const REPORT_TAB_VALUES: ReportTab[] = [
  "trial-balance",
  "income-statement",
  "balance-sheet",
];

function isReportTab(v: string): v is ReportTab {
  return (REPORT_TAB_VALUES as string[]).includes(v);
}

const TABS: Tab[] = [
  { label: "Trial Balance", value: "trial-balance" },
  { label: "Income Statement", value: "income-statement" },
  { label: "Balance Sheet", value: "balance-sheet" },
];

async function fetchTrialBalance(): Promise<TrialBalanceReport> {
  const res = await fetch("/api/reports?type=trial-balance");
  if (!res.ok) throw new Error("Failed to fetch trial balance");
  const json: ApiResponse<TrialBalanceReport> = await res.json();
  if (!json.data) throw new Error(json.error ?? "Unknown error");
  return json.data;
}

async function fetchIncomeStatement(
  startDate: string,
  endDate: string
): Promise<IncomeStatementReport> {
  const params = new URLSearchParams({
    type: "income-statement",
    startDate,
    endDate,
  });
  const res = await fetch(`/api/reports?${params}`);
  if (!res.ok) throw new Error("Failed to fetch income statement");
  const json: ApiResponse<IncomeStatementReport> = await res.json();
  if (!json.data) throw new Error(json.error ?? "Unknown error");
  return json.data;
}

async function fetchBalanceSheet(asOfDate: string): Promise<BalanceSheetReport> {
  const params = new URLSearchParams({ type: "balance-sheet", asOfDate });
  const res = await fetch(`/api/reports?${params}`);
  if (!res.ok) throw new Error("Failed to fetch balance sheet");
  const json: ApiResponse<BalanceSheetReport> = await res.json();
  if (!json.data) throw new Error(json.error ?? "Unknown error");
  return json.data;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function SkeletonLoader() {
  return (
    <div className="flex flex-col gap-3 py-8">
      <div className="h-4 w-1/3 rounded bg-slate-200 animate-pulse" />
      <div className="h-4 w-2/3 rounded bg-slate-200 animate-pulse" />
      <div className="h-4 w-1/2 rounded bg-slate-200 animate-pulse" />
      <div className="h-4 w-3/4 rounded bg-slate-200 animate-pulse" />
      <div className="h-4 w-1/4 rounded bg-slate-200 animate-pulse" />
    </div>
  );
}

function TrialBalanceView({ initialReport }: { initialReport: TrialBalanceReport | null }) {
  const [report, setReport] = useState<TrialBalanceReport | null>(initialReport);
  const [loading, setLoading] = useState(!initialReport);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setReport(await fetchTrialBalance());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialReport) {
      load();
    }
  }, [load, initialReport]);

  if (loading) return <SkeletonLoader />;
  if (error) return <ErrorBanner message={error} onRetry={load} />;
  if (!report) return null;

  return (
    <div className="flex flex-col gap-4">
      <ReportTable headers={["Code", "Account", "Debit", "Credit"]}>
        {report.rows.map((row) => (
          <tr key={row.accountCode} className="hover:bg-slate-50 transition-colors duration-150">
            <td className="py-2 pl-4 text-sm font-mono tabular-nums text-slate-400">
              {row.accountCode}
            </td>
            <td className="py-2 text-sm text-slate-800">{row.accountName}</td>
            <td className="py-2 text-sm font-mono tabular-nums text-right pr-2 text-slate-800">
              {row.debit}
            </td>
            <td className="py-2 text-sm font-mono tabular-nums text-right pr-4 text-slate-800">
              {row.credit}
            </td>
          </tr>
        ))}
        <TotalsRow
          label="Totals"
          values={[report.totalDebit, report.totalCredit]}
          balanced={report.isBalanced}
        />
      </ReportTable>
    </div>
  );
}

function IncomeStatementView() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  useEffect(() => {
    setStartDate(firstOfMonth());
    setEndDate(today());
  }, []);
  const [report, setReport] = useState<IncomeStatementReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!startDate || !endDate || startDate > endDate) return;
    try {
      setLoading(true);
      setError(null);
      setReport(await fetchIncomeStatement(startDate, endDate));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const { sections } = report ?? {};

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <label className="text-sm text-slate-500 whitespace-nowrap" htmlFor="is-start">
          Period
        </label>
        <input
          id="is-start"
          type="date"
          value={startDate}
          max={endDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="rounded-lg border border-slate-200 px-2 py-1 text-sm text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-colors"
        />
        <label htmlFor="is-end" className="text-sm text-slate-400">to</label>
        <input
          id="is-end"
          type="date"
          value={endDate}
          min={startDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="rounded-lg border border-slate-200 px-2 py-1 text-sm text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-colors"
        />
      </div>

      {loading ? (
        <SkeletonLoader />
      ) : error ? (
        <ErrorBanner message={error} onRetry={load} />
      ) : sections ? (
        <ReportTable headers={["Code", "Account", "Amount"]}>
          <ReportSection
            heading={sections.revenue.label}
            lines={sections.revenue.lines}
            total={sections.revenue.total}
          />
          <ReportSection
            heading={sections.cogs.label}
            lines={sections.cogs.lines}
            total={sections.cogs.total}
          />
          <SummaryLine
            label={sections.grossProfit.label}
            amount={sections.grossProfit.amount}
          />
          <ReportSection
            heading={sections.operatingExpenses.label}
            lines={sections.operatingExpenses.lines}
            total={sections.operatingExpenses.total}
          />
          <SummaryLine
            label={sections.netIncome.label}
            amount={sections.netIncome.amount}
            highlight
          />
        </ReportTable>
      ) : null}
    </div>
  );
}

function BalanceSheetView() {
  const [asOfDate, setAsOfDate] = useState("");

  useEffect(() => {
    setAsOfDate(today());
  }, []);
  const [report, setReport] = useState<BalanceSheetReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!asOfDate) return;
    try {
      setLoading(true);
      setError(null);
      setReport(await fetchBalanceSheet(asOfDate));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [asOfDate]);

  useEffect(() => { load(); }, [load]);

  const { sections } = report ?? {};

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <label className="text-sm text-slate-500 whitespace-nowrap" htmlFor="bs-date">
          As of
        </label>
        <input
          id="bs-date"
          type="date"
          value={asOfDate}
          onChange={(e) => setAsOfDate(e.target.value)}
          className="rounded-lg border border-slate-200 px-2 py-1 text-sm text-slate-800 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-colors"
        />
      </div>

      {loading ? (
        <SkeletonLoader />
      ) : error ? (
        <ErrorBanner message={error} onRetry={load} />
      ) : report && sections ? (
        <>
          <EquationBadge
            left={report.totalAssets}
            right={report.totalLiabilitiesAndEquity}
            isBalanced={report.isBalanced}
          />
          <ReportTable headers={["Code", "Account", "Amount"]}>
            <ReportSection
              heading={sections.assets.label}
              lines={sections.assets.lines}
              total={sections.assets.total}
            />
            <ReportSection
              heading={sections.liabilities.label}
              lines={sections.liabilities.lines}
              total={sections.liabilities.total}
            />
            <>
              <tr>
                <td
                  colSpan={3}
                  className="pt-5 pb-1 pl-4 text-xs font-semibold uppercase tracking-wider text-slate-400"
                >
                  {sections.equity.label}
                </td>
              </tr>
              {sections.equity.lines.map((row) => (
                <tr key={`equity-${row.code}`} className="hover:bg-slate-50 transition-colors duration-150">
                  <td className="py-2 pl-8 text-sm font-mono tabular-nums text-slate-400">
                    {row.code}
                  </td>
                  <td className="py-2 pl-2 text-sm text-slate-800">{row.name}</td>
                  <td className="py-2 text-sm font-mono tabular-nums text-right pr-4 text-slate-800">
                    {row.amount}
                  </td>
                </tr>
              ))}
              <tr className="hover:bg-slate-50 transition-colors duration-150">
                <td className="py-2 pl-8 text-sm font-mono tabular-nums text-slate-400" />
                <td className="py-2 pl-2 text-sm text-slate-500 italic">
                  {sections.equity.retainedEarnings.label}
                </td>
                <td className="py-2 text-sm font-mono tabular-nums text-right pr-4 text-slate-700">
                  {sections.equity.retainedEarnings.amount}
                </td>
              </tr>
              <tr className="border-t border-slate-200">
                <td className="py-2 pl-4 font-mono tabular-nums text-sm" />
                <td className="py-2 text-sm font-semibold text-slate-700">
                  Total Equity
                </td>
                <td className="py-2 text-sm font-semibold text-right font-mono tabular-nums text-slate-900 pr-4">
                  {sections.equity.total}
                </td>
              </tr>
            </>
            <TotalsRow
              label="Total Liabilities + Equity"
              values={[report.totalLiabilitiesAndEquity]}
            />
          </ReportTable>
        </>
      ) : null}
    </div>
  );
}

function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      <span>{message}</span>
      <button
        onClick={onRetry}
        className="ml-4 rounded-lg border border-red-300 px-2 py-1 text-xs hover:bg-red-100 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
      >
        Retry
      </button>
    </div>
  );
}

type Props = {
  initialTrialBalance: TrialBalanceReport | null;
};

export default function ReportsClient({ initialTrialBalance }: Props) {
  const [activeTab, setActiveTab] = useState<ReportTab>("trial-balance");

  return (
    <div className="flex flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Reports</h1>
      </div>

      <TabBar
        tabs={TABS}
        active={activeTab}
        onChange={(v) => { if (isReportTab(v)) setActiveTab(v); }}
      />

      {activeTab === "trial-balance" && <TrialBalanceView initialReport={initialTrialBalance} />}
      {activeTab === "income-statement" && <IncomeStatementView />}
      {activeTab === "balance-sheet" && <BalanceSheetView />}
    </div>
  );
}
