// Core accounting engine — enforces double-entry invariant and generates reports.
// All monetary amounts are integer cents. Never use floating-point dollars.

import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { Schema } from '@/db';
import { chartOfAccounts, journalEntries, journalLineItems } from '@/db/schema';
import type { Account, JournalEntry, LineItemPayload } from '@/lib/types';

export type Db = BetterSQLite3Database<Schema>;

export type ValidationResult = { valid: true } | { valid: false; error: string };

/**
 * Validates journal entry line items against double-entry rules:
 * - At least 2 lines
 * - Non-negative integer amounts
 * - Each line has exactly one of debit/credit > 0
 * - Total debits === total credits
 */
export function validateJournalEntry(lines: LineItemPayload[]): ValidationResult {
  if (lines.length < 2) {
    return { valid: false, error: 'Journal entry requires at least 2 line items' };
  }

  for (const line of lines) {
    if (!Number.isInteger(line.debitCents) || !Number.isInteger(line.creditCents)) {
      return {
        valid: false,
        error: `Line item amounts must be integer cents (no decimals), got debit=${line.debitCents} credit=${line.creditCents} for account ${line.accountId}`,
      };
    }
    if (line.debitCents < 0 || line.creditCents < 0) {
      return {
        valid: false,
        error: `Debit and credit amounts must be non-negative, got debit=${line.debitCents} credit=${line.creditCents} for account ${line.accountId}`,
      };
    }
    if (line.debitCents > 0 && line.creditCents > 0) {
      return {
        valid: false,
        error: `Line item for account ${line.accountId} cannot have both debit (${line.debitCents}¢) and credit (${line.creditCents}¢) > 0`,
      };
    }
    if (line.debitCents === 0 && line.creditCents === 0) {
      return {
        valid: false,
        error: `Line item for account ${line.accountId} must have a non-zero debit or credit`,
      };
    }
  }

  const totalDebitCents = lines.reduce((sum, l) => sum + l.debitCents, 0);
  const totalCreditCents = lines.reduce((sum, l) => sum + l.creditCents, 0);

  if (totalDebitCents !== totalCreditCents) {
    const diff = Math.abs(totalDebitCents - totalCreditCents);
    return {
      valid: false,
      error: `Entry is unbalanced: debits=${totalDebitCents}¢ credits=${totalCreditCents}¢ (difference: ${diff}¢ = $${(diff / 100).toFixed(2)})`,
    };
  }

  return { valid: true };
}

export type CreateJournalEntryInput = {
  date: string;
  description: string;
  lineItems: [LineItemPayload, LineItemPayload, ...LineItemPayload[]];
  transactionId?: number;
  status?: 'draft' | 'posted';
};

export function createJournalEntry(db: Db, input: CreateJournalEntryInput): JournalEntry {
  const validation = validateJournalEntry(input.lineItems);
  if (!validation.valid) {
    throw new Error(`Cannot create journal entry: ${validation.error}`);
  }

  return db.transaction((tx) => {
    const [entry] = tx
      .insert(journalEntries)
      .values({
        date: input.date,
        description: input.description,
        status: input.status ?? 'draft',
        transactionId: input.transactionId ?? null,
      })
      .returning()
      .all();

    tx.insert(journalLineItems)
      .values(
        input.lineItems.map((line) => ({
          entryId: entry.id,
          accountId: line.accountId,
          debitCents: line.debitCents,
          creditCents: line.creditCents,
        }))
      )
      .run();

    return entry;
  });
}

export function postJournalEntry(db: Db, entryId: number): JournalEntry {
  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.id, entryId))
      .get();

    if (!existing) {
      throw new Error(`Journal entry ${entryId} not found`);
    }
    if (existing.status !== 'draft') {
      throw new Error(
        `Can only post draft entries; entry ${entryId} has status '${existing.status}'`
      );
    }

    const [updated] = tx
      .update(journalEntries)
      .set({ status: 'posted', updatedAt: sql`(datetime('now'))` })
      .where(eq(journalEntries.id, entryId))
      .returning()
      .all();

    return updated;
  });
}

export function reverseJournalEntry(db: Db, entryId: number, reason?: string): JournalEntry {
  return db.transaction((tx) => {
    const original = tx
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.id, entryId))
      .get();

    if (!original) {
      throw new Error(`Journal entry ${entryId} not found`);
    }
    if (original.status !== 'posted') {
      throw new Error(
        `Can only reverse posted entries; entry ${entryId} has status '${original.status}'`
      );
    }

    const lines = tx
      .select()
      .from(journalLineItems)
      .where(eq(journalLineItems.entryId, entryId))
      .all();

    if (lines.length === 0) {
      throw new Error(`Journal entry ${entryId} has no line items to reverse`);
    }

    const reversedLines: LineItemPayload[] = lines.map((line) => ({
      accountId: line.accountId,
      debitCents: line.creditCents,
      creditCents: line.debitCents,
    }));

    const validation = validateJournalEntry(reversedLines);
    if (!validation.valid) {
      throw new Error(
        `Reversal of entry ${entryId} would be unbalanced (corrupt source data?): ${validation.error}`
      );
    }

    const today = new Date().toISOString().slice(0, 10);

    const [reversingEntry] = tx
      .insert(journalEntries)
      .values({
        date: today,
        description: reason
          ? `REVERSAL of entry #${entryId}: ${original.description} — Reason: ${reason}`
          : `REVERSAL of entry #${entryId}: ${original.description}`,
        status: 'posted',
        transactionId: null,
      })
      .returning()
      .all();

    tx.insert(journalLineItems)
      .values(
        reversedLines.map((line) => ({
          entryId: reversingEntry.id,
          accountId: line.accountId,
          debitCents: line.debitCents,
          creditCents: line.creditCents,
        }))
      )
      .run();

    tx.update(journalEntries)
      .set({ status: 'reversed', updatedAt: sql`(datetime('now'))` })
      .where(eq(journalEntries.id, entryId))
      .run();

    return reversingEntry;
  });
}

export function getAccountBalance(db: Db, accountId: number): number {
  const account = db
    .select({ type: chartOfAccounts.type })
    .from(chartOfAccounts)
    .where(eq(chartOfAccounts.id, accountId))
    .get();

  if (!account) {
    throw new Error(`Account ${accountId} not found`);
  }

  const result = db
    .select({
      totalDebitCents: sql<number>`COALESCE(SUM(${journalLineItems.debitCents}), 0)`,
      totalCreditCents: sql<number>`COALESCE(SUM(${journalLineItems.creditCents}), 0)`,
    })
    .from(journalLineItems)
    .innerJoin(journalEntries, eq(journalLineItems.entryId, journalEntries.id))
    .where(
      and(
        eq(journalLineItems.accountId, accountId),
        inArray(journalEntries.status, ['posted', 'reversed'])
      )
    )
    .get();

  if (!result) return 0;

  const isDebitNormal = account.type === 'asset' || account.type === 'expense';
  return isDebitNormal
    ? result.totalDebitCents - result.totalCreditCents
    : result.totalCreditCents - result.totalDebitCents;
}

export type TrialBalanceRow = {
  accountId: number;
  accountCode: string;
  accountName: string;
  accountType: Account['type'];
  totalDebitCents: number;
  totalCreditCents: number;
  /** Positive = debit balance, negative = credit balance. */
  netCents: number;
};

export type TrialBalance = {
  rows: TrialBalanceRow[];
  totalDebitCents: number;
  totalCreditCents: number;
  isBalanced: boolean;
};

export function calculateTrialBalance(db: Db): TrialBalance {
  const rows = db
    .select({
      accountId: chartOfAccounts.id,
      accountCode: chartOfAccounts.code,
      accountName: chartOfAccounts.name,
      accountType: chartOfAccounts.type,
      totalDebitCents: sql<number>`COALESCE(SUM(${journalLineItems.debitCents}), 0)`,
      totalCreditCents: sql<number>`COALESCE(SUM(${journalLineItems.creditCents}), 0)`,
    })
    .from(chartOfAccounts)
    .innerJoin(journalLineItems, eq(journalLineItems.accountId, chartOfAccounts.id))
    .innerJoin(journalEntries, eq(journalLineItems.entryId, journalEntries.id))
    .where(inArray(journalEntries.status, ['posted', 'reversed']))
    .groupBy(chartOfAccounts.id)
    .orderBy(chartOfAccounts.code)
    .all();

  const result: TrialBalanceRow[] = rows.map((row) => ({
    ...row,
    netCents: row.totalDebitCents - row.totalCreditCents,
  }));

  const totalDebitCents = result.reduce((sum, r) => sum + r.totalDebitCents, 0);
  const totalCreditCents = result.reduce((sum, r) => sum + r.totalCreditCents, 0);

  return {
    rows: result,
    totalDebitCents,
    totalCreditCents,
    isBalanced: totalDebitCents === totalCreditCents,
  };
}

// Income statement splits expenses into COGS (5xxx) and OpEx (6xxx+)

export type IncomeStatementLine = {
  accountCode: string;
  accountName: string;
  amountCents: number;
};

export type IncomeStatement = {
  startDate: string;
  endDate: string;
  revenue: IncomeStatementLine[];
  totalRevenueCents: number;
  cogs: IncomeStatementLine[];
  totalCogsCents: number;
  operatingExpenses: IncomeStatementLine[];
  totalOperatingExpensesCents: number;
  totalExpensesCents: number;
  netIncomeCents: number;
};

export function generateIncomeStatement(
  db: Db,
  startDate: string,
  endDate: string
): IncomeStatement {
  const rows = db
    .select({
      accountCode: chartOfAccounts.code,
      accountName: chartOfAccounts.name,
      accountType: chartOfAccounts.type,
      totalDebitCents: sql<number>`COALESCE(SUM(${journalLineItems.debitCents}), 0)`,
      totalCreditCents: sql<number>`COALESCE(SUM(${journalLineItems.creditCents}), 0)`,
    })
    .from(chartOfAccounts)
    .innerJoin(journalLineItems, eq(journalLineItems.accountId, chartOfAccounts.id))
    .innerJoin(journalEntries, eq(journalLineItems.entryId, journalEntries.id))
    .where(
      and(
        inArray(chartOfAccounts.type, ['revenue', 'expense']),
        inArray(journalEntries.status, ['posted', 'reversed']),
        gte(journalEntries.date, startDate),
        lte(journalEntries.date, endDate)
      )
    )
    .groupBy(chartOfAccounts.id)
    .orderBy(chartOfAccounts.code)
    .all();

  const revenue: IncomeStatementLine[] = [];
  const cogs: IncomeStatementLine[] = [];
  const operatingExpenses: IncomeStatementLine[] = [];

  for (const row of rows) {
    if (row.accountType === 'revenue') {
      revenue.push({
        accountCode: row.accountCode,
        accountName: row.accountName,
        amountCents: row.totalCreditCents - row.totalDebitCents,
      });
    } else {
      const amountCents = row.totalDebitCents - row.totalCreditCents;
      if (row.accountCode.startsWith('5')) {
        cogs.push({ accountCode: row.accountCode, accountName: row.accountName, amountCents });
      } else {
        operatingExpenses.push({
          accountCode: row.accountCode,
          accountName: row.accountName,
          amountCents,
        });
      }
    }
  }

  const totalRevenueCents = revenue.reduce((sum, r) => sum + r.amountCents, 0);
  const totalCogsCents = cogs.reduce((sum, r) => sum + r.amountCents, 0);
  const totalOperatingExpensesCents = operatingExpenses.reduce((sum, r) => sum + r.amountCents, 0);
  const totalExpensesCents = totalCogsCents + totalOperatingExpensesCents;
  const netIncomeCents = totalRevenueCents - totalExpensesCents;

  return {
    startDate,
    endDate,
    revenue,
    totalRevenueCents,
    cogs,
    totalCogsCents,
    operatingExpenses,
    totalOperatingExpensesCents,
    totalExpensesCents,
    netIncomeCents,
  };
}

// Balance sheet: A = L + E + Net Income

export type BalanceSheetLine = {
  accountCode: string;
  accountName: string;
  amountCents: number;
};

export type BalanceSheetSection = {
  accounts: BalanceSheetLine[];
  totalCents: number;
};

export type BalanceSheet = {
  asOfDate: string;
  assets: BalanceSheetSection;
  liabilities: BalanceSheetSection;
  equity: BalanceSheetSection;
  /**
   * Unbooked retained earnings — revenue/expense accounts remain open
   * until a closing entry is created, so net income flows here.
   */
  netIncomeCents: number;
  totalAssetsCents: number;
  totalLiabilitiesAndEquityCents: number;
  isBalanced: boolean;
};

export function generateBalanceSheet(db: Db, asOfDate: string): BalanceSheet {
  const rows = db
    .select({
      accountCode: chartOfAccounts.code,
      accountName: chartOfAccounts.name,
      accountType: chartOfAccounts.type,
      totalDebitCents: sql<number>`COALESCE(SUM(${journalLineItems.debitCents}), 0)`,
      totalCreditCents: sql<number>`COALESCE(SUM(${journalLineItems.creditCents}), 0)`,
    })
    .from(chartOfAccounts)
    .innerJoin(journalLineItems, eq(journalLineItems.accountId, chartOfAccounts.id))
    .innerJoin(journalEntries, eq(journalLineItems.entryId, journalEntries.id))
    .where(
      and(
        inArray(journalEntries.status, ['posted', 'reversed']),
        lte(journalEntries.date, asOfDate)
      )
    )
    .groupBy(chartOfAccounts.id)
    .orderBy(chartOfAccounts.code)
    .all();

  const assets: BalanceSheetLine[] = [];
  const liabilities: BalanceSheetLine[] = [];
  const equityAccounts: BalanceSheetLine[] = [];
  let totalRevenueCents = 0;
  let totalExpenseCents = 0;

  for (const row of rows) {
    switch (row.accountType) {
      case 'asset':
        assets.push({
          accountCode: row.accountCode,
          accountName: row.accountName,
          amountCents: row.totalDebitCents - row.totalCreditCents,
        });
        break;
      case 'liability':
        liabilities.push({
          accountCode: row.accountCode,
          accountName: row.accountName,
          amountCents: row.totalCreditCents - row.totalDebitCents,
        });
        break;
      case 'equity':
        equityAccounts.push({
          accountCode: row.accountCode,
          accountName: row.accountName,
          amountCents: row.totalCreditCents - row.totalDebitCents,
        });
        break;
      case 'revenue':
        totalRevenueCents += row.totalCreditCents - row.totalDebitCents;
        break;
      case 'expense':
        totalExpenseCents += row.totalDebitCents - row.totalCreditCents;
        break;
    }
  }

  const netIncomeCents = totalRevenueCents - totalExpenseCents;
  const totalAssetsCents = assets.reduce((sum, a) => sum + a.amountCents, 0);
  const totalLiabilitiesCents = liabilities.reduce((sum, l) => sum + l.amountCents, 0);
  const totalEquityCents = equityAccounts.reduce((sum, e) => sum + e.amountCents, 0);
  const totalLiabilitiesAndEquityCents = totalLiabilitiesCents + totalEquityCents + netIncomeCents;

  return {
    asOfDate,
    assets: { accounts: assets, totalCents: totalAssetsCents },
    liabilities: { accounts: liabilities, totalCents: totalLiabilitiesCents },
    equity: { accounts: equityAccounts, totalCents: totalEquityCents },
    netIncomeCents,
    totalAssetsCents,
    totalLiabilitiesAndEquityCents,
    isBalanced: totalAssetsCents === totalLiabilitiesAndEquityCents,
  };
}
