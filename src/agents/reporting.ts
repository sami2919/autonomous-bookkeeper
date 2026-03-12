// Financial reporting — pure computation, no LLM involvement.

import type { Db } from '@/lib/accounting';
import {
  calculateTrialBalance,
  generateBalanceSheet,
  generateIncomeStatement,
} from '@/lib/accounting';
import { formatAccountingCurrency as formatDollars } from '@/lib/format';

function assertValidDate(label: string, value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be an ISO 8601 date (YYYY-MM-DD), got: "${value}"`);
  }
}

export type TrialBalanceReport = {
  rows: Array<{
    accountCode: string;
    accountName: string;
    accountType: string;
    debit: string;
    credit: string;
  }>;
  totalDebit: string;
  totalCredit: string;
  isBalanced: boolean;
};

export function getTrialBalance(db: Db): TrialBalanceReport {
  const data = calculateTrialBalance(db);

  const rows = data.rows.map((row) => {
    const isDebitNormal = row.accountType === 'asset' || row.accountType === 'expense';
    const balance = Math.abs(row.netCents);

    return {
      accountCode: row.accountCode,
      accountName: row.accountName,
      accountType: row.accountType,
      debit: isDebitNormal ? formatDollars(balance) : '',
      credit: isDebitNormal ? '' : formatDollars(balance),
    };
  });

  return {
    rows,
    totalDebit: formatDollars(data.totalDebitCents),
    totalCredit: formatDollars(data.totalCreditCents),
    isBalanced: data.isBalanced,
  };
}

export type IncomeStatementReport = {
  period: { startDate: string; endDate: string };
  sections: {
    revenue: { label: string; lines: Array<{ code: string; name: string; amount: string }>; total: string };
    cogs: { label: string; lines: Array<{ code: string; name: string; amount: string }>; total: string };
    grossProfit: { label: string; amount: string };
    operatingExpenses: { label: string; lines: Array<{ code: string; name: string; amount: string }>; total: string };
    netIncome: { label: string; amount: string };
  };
};

export function getIncomeStatement(db: Db, startDate: string, endDate: string): IncomeStatementReport {
  assertValidDate('startDate', startDate);
  assertValidDate('endDate', endDate);
  const data = generateIncomeStatement(db, startDate, endDate);
  const grossProfitCents = data.totalRevenueCents - data.totalCogsCents;

  return {
    period: { startDate: data.startDate, endDate: data.endDate },
    sections: {
      revenue: {
        label: 'Revenue',
        lines: data.revenue.map((r) => ({
          code: r.accountCode,
          name: r.accountName,
          amount: formatDollars(r.amountCents),
        })),
        total: formatDollars(data.totalRevenueCents),
      },
      cogs: {
        label: 'Cost of Goods Sold',
        lines: data.cogs.map((r) => ({
          code: r.accountCode,
          name: r.accountName,
          amount: formatDollars(r.amountCents),
        })),
        total: formatDollars(data.totalCogsCents),
      },
      grossProfit: {
        label: 'Gross Profit',
        amount: formatDollars(grossProfitCents),
      },
      operatingExpenses: {
        label: 'Operating Expenses',
        lines: data.operatingExpenses.map((r) => ({
          code: r.accountCode,
          name: r.accountName,
          amount: formatDollars(r.amountCents),
        })),
        total: formatDollars(data.totalOperatingExpensesCents),
      },
      netIncome: {
        label: 'Net Income',
        amount: formatDollars(data.netIncomeCents),
      },
    },
  };
}

export type BalanceSheetReport = {
  asOfDate: string;
  sections: {
    assets: { label: string; lines: Array<{ code: string; name: string; amount: string }>; total: string };
    liabilities: { label: string; lines: Array<{ code: string; name: string; amount: string }>; total: string };
    equity: {
      label: string;
      lines: Array<{ code: string; name: string; amount: string }>;
      retainedEarnings: { label: string; amount: string };
      total: string;
    };
  };
  totalAssets: string;
  totalLiabilitiesAndEquity: string;
  isBalanced: boolean;
};

export function getBalanceSheet(db: Db, asOfDate: string): BalanceSheetReport {
  assertValidDate('asOfDate', asOfDate);
  const data = generateBalanceSheet(db, asOfDate);

  const totalEquityWithNetIncome =
    data.equity.totalCents + data.netIncomeCents;

  return {
    asOfDate: data.asOfDate,
    sections: {
      assets: {
        label: 'Assets',
        lines: data.assets.accounts.map((a) => ({
          code: a.accountCode,
          name: a.accountName,
          amount: formatDollars(a.amountCents),
        })),
        total: formatDollars(data.totalAssetsCents),
      },
      liabilities: {
        label: 'Liabilities',
        lines: data.liabilities.accounts.map((l) => ({
          code: l.accountCode,
          name: l.accountName,
          amount: formatDollars(l.amountCents),
        })),
        total: formatDollars(data.liabilities.totalCents),
      },
      equity: {
        label: 'Equity',
        lines: data.equity.accounts.map((e) => ({
          code: e.accountCode,
          name: e.accountName,
          amount: formatDollars(e.amountCents),
        })),
        retainedEarnings: {
          label: 'Retained Earnings (Current Period)',
          amount: formatDollars(data.netIncomeCents),
        },
        total: formatDollars(totalEquityWithNetIncome),
      },
    },
    totalAssets: formatDollars(data.totalAssetsCents),
    totalLiabilitiesAndEquity: formatDollars(data.totalLiabilitiesAndEquityCents),
    isBalanced: data.isBalanced,
  };
}
