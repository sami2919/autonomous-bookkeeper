/**
 * Accounting invariant tests — the highest-value tests in the project.
 *
 * These tests prove the double-entry invariant holds at the data layer,
 * independent of what the UI or agents do above it. Each test runs against
 * a fresh in-memory SQLite database so failures can never bleed between cases.
 *
 * Key invariants tested:
 *   1. SUM(debits) === SUM(credits) for every posted entry (trial balance)
 *   2. Assets = Liabilities + Equity + Net Income (balance sheet equation)
 *   3. Revenue - COGS - OpEx = Net Income (income statement math)
 *   4. Reversals zero out the original entry's ledger impact
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { describe, it, expect, beforeEach } from 'vitest';
import * as schema from '@/db/schema';
import { chartOfAccounts, journalEntries, journalLineItems } from '@/db/schema';
import {
  calculateTrialBalance,
  createJournalEntry,
  generateBalanceSheet,
  generateIncomeStatement,
  getAccountBalance,
  postJournalEntry,
  reverseJournalEntry,
  validateJournalEntry,
  type Db,
} from '@/lib/accounting';

// ─── Test DB Factory ──────────────────────────────────────────────────────────
//
// Each test gets a completely isolated in-memory SQLite database.
// No temp files, no cleanup, no shared state between tests.

function createTestDb(): Db {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');

  // Replicate the production schema exactly so tests run against real DDL.
  // Split on drizzle-kit's statement separator to run each DDL individually.
  sqlite.exec(`
    CREATE TABLE chart_of_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      parent_id INTEGER,
      is_active INTEGER DEFAULT true NOT NULL,
      FOREIGN KEY (parent_id) REFERENCES chart_of_accounts(id)
    );
    CREATE UNIQUE INDEX chart_of_accounts_code_unique ON chart_of_accounts (code);

    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      external_id TEXT NOT NULL,
      date TEXT NOT NULL,
      merchant_name TEXT,
      description TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      category_confidence INTEGER,
      status TEXT DEFAULT 'pending' NOT NULL,
      account_id INTEGER,
      agent_reasoning TEXT,
      created_at TEXT DEFAULT (datetime('now')) NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')) NOT NULL,
      FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id)
    );
    CREATE UNIQUE INDEX transactions_external_id_unique ON transactions (external_id);

    CREATE TABLE journal_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT DEFAULT 'draft' NOT NULL,
      transaction_id INTEGER,
      created_at TEXT DEFAULT (datetime('now')) NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')) NOT NULL,
      FOREIGN KEY (transaction_id) REFERENCES transactions(id)
    );
    CREATE UNIQUE INDEX journal_entries_transaction_id_unique ON journal_entries (transaction_id);

    CREATE TABLE journal_line_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      entry_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      debit_cents INTEGER DEFAULT 0 NOT NULL,
      credit_cents INTEGER DEFAULT 0 NOT NULL,
      FOREIGN KEY (entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE,
      FOREIGN KEY (account_id) REFERENCES chart_of_accounts(id)
    );

    CREATE TABLE customer_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      transaction_id INTEGER NOT NULL,
      direction TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')) NOT NULL,
      FOREIGN KEY (transaction_id) REFERENCES transactions(id)
    );
  `);

  return drizzle(sqlite, { schema });
}

// ─── Seed Helpers ─────────────────────────────────────────────────────────────

type SeedAccounts = {
  cash: number;     // 1001 — asset (debit-normal)
  ap: number;       // 2001 — liability (credit-normal)
  equity: number;   // 3001 — equity (credit-normal)
  revenue: number;  // 4001 — revenue (credit-normal)
  cogs: number;     // 5001 — expense/COGS (debit-normal, code starts with '5')
  opex: number;     // 6001 — expense/OpEx (debit-normal, code starts with '6')
};

function seedAccounts(db: Db): SeedAccounts {
  const rows = db
    .insert(chartOfAccounts)
    .values([
      { code: '1001', name: 'Cash', type: 'asset' },
      { code: '2001', name: 'Accounts Payable', type: 'liability' },
      { code: '3001', name: "Owner's Equity", type: 'equity' },
      { code: '4001', name: 'Service Revenue', type: 'revenue' },
      { code: '5001', name: 'Cost of Goods Sold', type: 'expense' },
      { code: '6001', name: 'Rent Expense', type: 'expense' },
    ])
    .returning()
    .all();

  return {
    cash: rows[0].id,
    ap: rows[1].id,
    equity: rows[2].id,
    revenue: rows[3].id,
    cogs: rows[4].id,
    opex: rows[5].id,
  };
}

// ─── Validation Tests ─────────────────────────────────────────────────────────

describe('validateJournalEntry', () => {
  it('balanced entry passes validation', () => {
    const result = validateJournalEntry([
      { accountId: 1, debitCents: 10000, creditCents: 0 },
      { accountId: 2, debitCents: 0, creditCents: 10000 },
    ]);
    expect(result.valid).toBe(true);
  });

  it('multi-line balanced entry passes validation', () => {
    // Split debit across two accounts — still balanced
    const result = validateJournalEntry([
      { accountId: 1, debitCents: 6000, creditCents: 0 },
      { accountId: 3, debitCents: 4000, creditCents: 0 },
      { accountId: 2, debitCents: 0, creditCents: 10000 },
    ]);
    expect(result.valid).toBe(true);
  });

  it('unbalanced entry returns an error', () => {
    const result = validateJournalEntry([
      { accountId: 1, debitCents: 10000, creditCents: 0 },
      { accountId: 2, debitCents: 0, creditCents: 9999 }, // off by 1¢
    ]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toMatch(/unbalanced/i);
      expect(result.error).toContain('10000');
      expect(result.error).toContain('9999');
    }
  });

  it('single line item returns an error', () => {
    const result = validateJournalEntry([
      { accountId: 1, debitCents: 10000, creditCents: 0 },
    ]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toMatch(/at least 2/i);
    }
  });

  it('line with both debit and credit > 0 returns an error', () => {
    const result = validateJournalEntry([
      { accountId: 1, debitCents: 10000, creditCents: 5000 }, // both > 0
      { accountId: 2, debitCents: 0, creditCents: 5000 },
    ]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toMatch(/both debit.*credit/i);
    }
  });

  it('line with zero debit and zero credit returns an error', () => {
    const result = validateJournalEntry([
      { accountId: 1, debitCents: 0, creditCents: 0 }, // both zero
      { accountId: 2, debitCents: 0, creditCents: 0 },
    ]);
    expect(result.valid).toBe(false);
  });

  it('negative amounts return an error', () => {
    const result = validateJournalEntry([
      { accountId: 1, debitCents: -100, creditCents: 0 },
      { accountId: 2, debitCents: 0, creditCents: -100 },
    ]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toMatch(/non-negative/i);
    }
  });
});

// ─── createJournalEntry Tests ─────────────────────────────────────────────────

describe('createJournalEntry', () => {
  let db: Db;
  let accounts: SeedAccounts;

  beforeEach(() => {
    db = createTestDb();
    accounts = seedAccounts(db);
  });

  it('creates entry and correct line items in the database', () => {
    const entry = createJournalEntry(db, {
      date: '2026-01-15',
      description: 'Cash payment for services',
      lineItems: [
        { accountId: accounts.cash, debitCents: 5000, creditCents: 0 },
        { accountId: accounts.revenue, debitCents: 0, creditCents: 5000 },
      ],
    });

    expect(entry.id).toBeGreaterThan(0);
    expect(entry.status).toBe('draft');
    expect(entry.description).toBe('Cash payment for services');
    expect(entry.date).toBe('2026-01-15');

    // Verify line items were actually persisted
    const lines = db
      .select()
      .from(journalLineItems)
      .where(eq(journalLineItems.entryId, entry.id))
      .all();

    expect(lines).toHaveLength(2);
    const debitLine = lines.find((l) => l.debitCents > 0)!;
    const creditLine = lines.find((l) => l.creditCents > 0)!;
    expect(debitLine.debitCents).toBe(5000);
    expect(debitLine.accountId).toBe(accounts.cash);
    expect(creditLine.creditCents).toBe(5000);
    expect(creditLine.accountId).toBe(accounts.revenue);
  });

  it('throws for an unbalanced entry — no partial DB write', () => {
    expect(() =>
      createJournalEntry(db, {
        date: '2026-01-15',
        description: 'Unbalanced entry',
        lineItems: [
          { accountId: accounts.cash, debitCents: 5000, creditCents: 0 },
          { accountId: accounts.revenue, debitCents: 0, creditCents: 4999 },
        ],
      })
    ).toThrow(/unbalanced/i);

    // Nothing should have been written to the DB
    const entries = db.select().from(journalEntries).all();
    expect(entries).toHaveLength(0);
  });

  it('creates entry in draft status by default', () => {
    const entry = createJournalEntry(db, {
      date: '2026-01-15',
      description: 'Test entry',
      lineItems: [
        { accountId: accounts.cash, debitCents: 1000, creditCents: 0 },
        { accountId: accounts.equity, debitCents: 0, creditCents: 1000 },
      ],
    });
    expect(entry.status).toBe('draft');
  });

  it('creates entry in posted status when explicitly requested', () => {
    const entry = createJournalEntry(db, {
      date: '2026-01-15',
      description: 'Test posted entry',
      status: 'posted',
      lineItems: [
        { accountId: accounts.cash, debitCents: 1000, creditCents: 0 },
        { accountId: accounts.equity, debitCents: 0, creditCents: 1000 },
      ],
    });
    expect(entry.status).toBe('posted');
  });
});

// ─── postJournalEntry Tests ───────────────────────────────────────────────────

describe('postJournalEntry', () => {
  let db: Db;
  let accounts: SeedAccounts;

  beforeEach(() => {
    db = createTestDb();
    accounts = seedAccounts(db);
  });

  it('transitions a draft entry to posted', () => {
    const draft = createJournalEntry(db, {
      date: '2026-01-15',
      description: 'Draft entry',
      lineItems: [
        { accountId: accounts.cash, debitCents: 2000, creditCents: 0 },
        { accountId: accounts.revenue, debitCents: 0, creditCents: 2000 },
      ],
    });
    expect(draft.status).toBe('draft');

    const posted = postJournalEntry(db, draft.id);
    expect(posted.status).toBe('posted');
    expect(posted.id).toBe(draft.id);
  });

  it('throws when entry does not exist', () => {
    expect(() => postJournalEntry(db, 9999)).toThrow(/not found/i);
  });

  it('throws when entry is already posted', () => {
    const draft = createJournalEntry(db, {
      date: '2026-01-15',
      description: 'Double-post test',
      lineItems: [
        { accountId: accounts.cash, debitCents: 2000, creditCents: 0 },
        { accountId: accounts.revenue, debitCents: 0, creditCents: 2000 },
      ],
    });
    postJournalEntry(db, draft.id);
    expect(() => postJournalEntry(db, draft.id)).toThrow(/draft/i);
  });
});

// ─── reverseJournalEntry Tests ────────────────────────────────────────────────

describe('reverseJournalEntry', () => {
  let db: Db;
  let accounts: SeedAccounts;

  beforeEach(() => {
    db = createTestDb();
    accounts = seedAccounts(db);
  });

  it('creates a reversing entry that swaps debits and credits', () => {
    // Create and post an entry: Dr Cash 10000 / Cr Revenue 10000
    const draft = createJournalEntry(db, {
      date: '2026-01-15',
      description: 'Service revenue',
      lineItems: [
        { accountId: accounts.cash, debitCents: 10000, creditCents: 0 },
        { accountId: accounts.revenue, debitCents: 0, creditCents: 10000 },
      ],
    });
    const original = postJournalEntry(db, draft.id);

    // Reverse it
    const reversal = reverseJournalEntry(db, original.id);

    // Reversal entry is immediately posted
    expect(reversal.status).toBe('posted');
    expect(reversal.description).toContain(`REVERSAL of entry #${original.id}`);

    // Original entry should now be marked 'reversed'
    const updatedOriginal = db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.id, original.id))
      .get();
    expect(updatedOriginal?.status).toBe('reversed');

    // Reversal line items should have swapped debits/credits
    const reversalLines = db
      .select()
      .from(journalLineItems)
      .where(eq(journalLineItems.entryId, reversal.id))
      .all();

    expect(reversalLines).toHaveLength(2);
    const cashReversalLine = reversalLines.find((l) => l.accountId === accounts.cash)!;
    const revenueReversalLine = reversalLines.find((l) => l.accountId === accounts.revenue)!;
    // Original: Dr Cash. Reversal: Cr Cash
    expect(cashReversalLine.debitCents).toBe(0);
    expect(cashReversalLine.creditCents).toBe(10000);
    // Original: Cr Revenue. Reversal: Dr Revenue
    expect(revenueReversalLine.debitCents).toBe(10000);
    expect(revenueReversalLine.creditCents).toBe(0);
  });

  it('throws when reversing a non-posted (draft) entry', () => {
    const draft = createJournalEntry(db, {
      date: '2026-01-15',
      description: 'Draft entry',
      lineItems: [
        { accountId: accounts.cash, debitCents: 5000, creditCents: 0 },
        { accountId: accounts.equity, debitCents: 0, creditCents: 5000 },
      ],
    });
    expect(() => reverseJournalEntry(db, draft.id)).toThrow(/posted/i);
  });

  it('throws when reversing a non-existent entry', () => {
    expect(() => reverseJournalEntry(db, 9999)).toThrow(/not found/i);
  });
});

// ─── getAccountBalance Tests ──────────────────────────────────────────────────

describe('getAccountBalance', () => {
  let db: Db;
  let accounts: SeedAccounts;

  beforeEach(() => {
    db = createTestDb();
    accounts = seedAccounts(db);
  });

  it('returns zero for an account with no posted activity', () => {
    expect(getAccountBalance(db, accounts.cash)).toBe(0);
    expect(getAccountBalance(db, accounts.revenue)).toBe(0);
  });

  it('returns zero when entries exist but are only drafts', () => {
    createJournalEntry(db, {
      date: '2026-01-15',
      description: 'Draft — not in balance',
      lineItems: [
        { accountId: accounts.cash, debitCents: 5000, creditCents: 0 },
        { accountId: accounts.revenue, debitCents: 0, creditCents: 5000 },
      ],
    });
    // Draft entries must not affect balances
    expect(getAccountBalance(db, accounts.cash)).toBe(0);
  });

  it('returns positive debit balance for asset account (debit-normal)', () => {
    const draft = createJournalEntry(db, {
      date: '2026-01-15',
      description: 'Cash received',
      lineItems: [
        { accountId: accounts.cash, debitCents: 5000, creditCents: 0 },
        { accountId: accounts.revenue, debitCents: 0, creditCents: 5000 },
      ],
    });
    postJournalEntry(db, draft.id);
    // Asset is debit-normal: debits increase, credits decrease
    expect(getAccountBalance(db, accounts.cash)).toBe(5000);
  });

  it('returns positive credit balance for revenue account (credit-normal)', () => {
    const draft = createJournalEntry(db, {
      date: '2026-01-15',
      description: 'Cash received',
      lineItems: [
        { accountId: accounts.cash, debitCents: 5000, creditCents: 0 },
        { accountId: accounts.revenue, debitCents: 0, creditCents: 5000 },
      ],
    });
    postJournalEntry(db, draft.id);
    // Revenue is credit-normal: credits increase, debits decrease
    expect(getAccountBalance(db, accounts.revenue)).toBe(5000);
  });

  it('nets to zero after a reversal', () => {
    const draft = createJournalEntry(db, {
      date: '2026-01-15',
      description: 'Cash received',
      lineItems: [
        { accountId: accounts.cash, debitCents: 5000, creditCents: 0 },
        { accountId: accounts.revenue, debitCents: 0, creditCents: 5000 },
      ],
    });
    const posted = postJournalEntry(db, draft.id);
    reverseJournalEntry(db, posted.id);

    // After reversal: original (reversed) + reversing entry net to zero
    expect(getAccountBalance(db, accounts.cash)).toBe(0);
    expect(getAccountBalance(db, accounts.revenue)).toBe(0);
  });

  it('throws for a non-existent account', () => {
    expect(() => getAccountBalance(db, 9999)).toThrow(/not found/i);
  });
});

// ─── calculateTrialBalance Tests ──────────────────────────────────────────────

describe('calculateTrialBalance', () => {
  let db: Db;
  let accounts: SeedAccounts;

  beforeEach(() => {
    db = createTestDb();
    accounts = seedAccounts(db);
  });

  it('returns empty rows and isBalanced=true for an empty ledger', () => {
    const tb = calculateTrialBalance(db);
    expect(tb.rows).toHaveLength(0);
    expect(tb.totalDebitCents).toBe(0);
    expect(tb.totalCreditCents).toBe(0);
    expect(tb.isBalanced).toBe(true);
  });

  it('excludes draft entries — only posted entries in trial balance', () => {
    createJournalEntry(db, {
      date: '2026-01-15',
      description: 'Unpublished draft',
      lineItems: [
        { accountId: accounts.cash, debitCents: 3000, creditCents: 0 },
        { accountId: accounts.revenue, debitCents: 0, creditCents: 3000 },
      ],
    });
    const tb = calculateTrialBalance(db);
    expect(tb.rows).toHaveLength(0);
    expect(tb.isBalanced).toBe(true);
  });

  it('nets to zero after a single posted entry', () => {
    const draft = createJournalEntry(db, {
      date: '2026-01-15',
      description: 'Revenue entry',
      lineItems: [
        { accountId: accounts.cash, debitCents: 10000, creditCents: 0 },
        { accountId: accounts.revenue, debitCents: 0, creditCents: 10000 },
      ],
    });
    postJournalEntry(db, draft.id);

    const tb = calculateTrialBalance(db);
    expect(tb.totalDebitCents).toBe(10000);
    expect(tb.totalCreditCents).toBe(10000);
    expect(tb.isBalanced).toBe(true);
  });

  it('remains balanced after multiple posted entries', () => {
    // Entry 1: Cash received for services
    const d1 = createJournalEntry(db, {
      date: '2026-01-15',
      description: 'Service revenue',
      lineItems: [
        { accountId: accounts.cash, debitCents: 10000, creditCents: 0 },
        { accountId: accounts.revenue, debitCents: 0, creditCents: 10000 },
      ],
    });
    postJournalEntry(db, d1.id);

    // Entry 2: Pay rent
    const d2 = createJournalEntry(db, {
      date: '2026-01-20',
      description: 'Rent payment',
      lineItems: [
        { accountId: accounts.opex, debitCents: 2000, creditCents: 0 },
        { accountId: accounts.cash, debitCents: 0, creditCents: 2000 },
      ],
    });
    postJournalEntry(db, d2.id);

    // Entry 3: Incur COGS
    const d3 = createJournalEntry(db, {
      date: '2026-01-22',
      description: 'COGS incurred',
      lineItems: [
        { accountId: accounts.cogs, debitCents: 3000, creditCents: 0 },
        { accountId: accounts.ap, debitCents: 0, creditCents: 3000 },
      ],
    });
    postJournalEntry(db, d3.id);

    const tb = calculateTrialBalance(db);
    expect(tb.isBalanced).toBe(true);
    // Total debits = 10000 + 2000 + 3000 = 15000
    expect(tb.totalDebitCents).toBe(15000);
    expect(tb.totalCreditCents).toBe(15000);
  });

  it('remains balanced after a reversal — reversed entries net to zero', () => {
    const draft = createJournalEntry(db, {
      date: '2026-01-15',
      description: 'Revenue — to be reversed',
      lineItems: [
        { accountId: accounts.cash, debitCents: 5000, creditCents: 0 },
        { accountId: accounts.revenue, debitCents: 0, creditCents: 5000 },
      ],
    });
    const posted = postJournalEntry(db, draft.id);
    reverseJournalEntry(db, posted.id);

    // Both original (reversed) and reversal (posted) are included, net = 0
    const tb = calculateTrialBalance(db);
    // original: Dr 5000 Cr 5000; reversal: Dr 5000 Cr 5000 → totals = 10000 / 10000
    expect(tb.totalDebitCents).toBe(10000);
    expect(tb.totalCreditCents).toBe(10000);
    expect(tb.isBalanced).toBe(true);
  });
});

// ─── generateBalanceSheet Tests ───────────────────────────────────────────────

describe('generateBalanceSheet', () => {
  let db: Db;
  let accounts: SeedAccounts;

  beforeEach(() => {
    db = createTestDb();
    accounts = seedAccounts(db);
  });

  it('balance sheet equation holds: Assets = Liabilities + Equity + Net Income', () => {
    // Dr Cash 10000 / Cr Revenue 10000
    const d1 = createJournalEntry(db, {
      date: '2026-01-15',
      description: 'Service revenue',
      lineItems: [
        { accountId: accounts.cash, debitCents: 10000, creditCents: 0 },
        { accountId: accounts.revenue, debitCents: 0, creditCents: 10000 },
      ],
    });
    postJournalEntry(db, d1.id);

    // Dr Rent Expense 2000 / Cr Cash 2000
    const d2 = createJournalEntry(db, {
      date: '2026-01-20',
      description: 'Rent payment',
      lineItems: [
        { accountId: accounts.opex, debitCents: 2000, creditCents: 0 },
        { accountId: accounts.cash, debitCents: 0, creditCents: 2000 },
      ],
    });
    postJournalEntry(db, d2.id);

    const bs = generateBalanceSheet(db, '2026-01-31');

    // Cash = 10000 - 2000 = 8000
    expect(bs.assets.totalCents).toBe(8000);
    // No liabilities or equity entries
    expect(bs.liabilities.totalCents).toBe(0);
    expect(bs.equity.totalCents).toBe(0);
    // Net income = Revenue - Expenses = 10000 - 2000 = 8000
    expect(bs.netIncomeCents).toBe(8000);
    // Equation: Assets (8000) = L (0) + E (0) + NI (8000) = 8000 ✓
    expect(bs.totalAssetsCents).toBe(bs.totalLiabilitiesAndEquityCents);
    expect(bs.isBalanced).toBe(true);
  });

  it('isBalanced holds for equity-funded assets', () => {
    // Owner invests capital: Dr Cash 50000 / Cr Equity 50000
    const d1 = createJournalEntry(db, {
      date: '2026-01-01',
      description: 'Owner investment',
      lineItems: [
        { accountId: accounts.cash, debitCents: 50000, creditCents: 0 },
        { accountId: accounts.equity, debitCents: 0, creditCents: 50000 },
      ],
    });
    postJournalEntry(db, d1.id);

    const bs = generateBalanceSheet(db, '2026-01-31');
    expect(bs.totalAssetsCents).toBe(50000);
    // Assets = Equity (50000) + Net Income (0) = 50000
    expect(bs.isBalanced).toBe(true);
  });

  it('returns all zeros for an empty ledger', () => {
    const bs = generateBalanceSheet(db, '2026-01-31');
    expect(bs.totalAssetsCents).toBe(0);
    expect(bs.totalLiabilitiesAndEquityCents).toBe(0);
    expect(bs.netIncomeCents).toBe(0);
    expect(bs.isBalanced).toBe(true);
  });
});

// ─── generateIncomeStatement Tests ───────────────────────────────────────────

describe('generateIncomeStatement', () => {
  let db: Db;
  let accounts: SeedAccounts;

  beforeEach(() => {
    db = createTestDb();
    accounts = seedAccounts(db);
  });

  it('income statement sums correctly: Revenue - COGS - OpEx = Net Income', () => {
    // Revenue: Dr Cash 10000 / Cr Service Revenue 10000
    const d1 = createJournalEntry(db, {
      date: '2026-01-15',
      description: 'Service revenue',
      lineItems: [
        { accountId: accounts.cash, debitCents: 10000, creditCents: 0 },
        { accountId: accounts.revenue, debitCents: 0, creditCents: 10000 },
      ],
    });
    postJournalEntry(db, d1.id);

    // COGS: Dr COGS 3000 / Cr Cash 3000
    const d2 = createJournalEntry(db, {
      date: '2026-01-16',
      description: 'Cost of goods sold',
      lineItems: [
        { accountId: accounts.cogs, debitCents: 3000, creditCents: 0 },
        { accountId: accounts.cash, debitCents: 0, creditCents: 3000 },
      ],
    });
    postJournalEntry(db, d2.id);

    // OpEx: Dr Rent Expense 2000 / Cr Cash 2000
    const d3 = createJournalEntry(db, {
      date: '2026-01-20',
      description: 'Rent payment',
      lineItems: [
        { accountId: accounts.opex, debitCents: 2000, creditCents: 0 },
        { accountId: accounts.cash, debitCents: 0, creditCents: 2000 },
      ],
    });
    postJournalEntry(db, d3.id);

    const is = generateIncomeStatement(db, '2026-01-01', '2026-01-31');

    expect(is.totalRevenueCents).toBe(10000);
    expect(is.totalCogsCents).toBe(3000);
    expect(is.totalOperatingExpensesCents).toBe(2000);
    expect(is.totalExpensesCents).toBe(5000);   // COGS + OpEx
    expect(is.netIncomeCents).toBe(5000);        // 10000 - 5000

    // Verify individual line items
    expect(is.revenue).toHaveLength(1);
    expect(is.cogs).toHaveLength(1);
    expect(is.operatingExpenses).toHaveLength(1);
    expect(is.cogs[0].accountCode).toBe('5001');        // 5xxx = COGS
    expect(is.operatingExpenses[0].accountCode).toBe('6001'); // 6xxx = OpEx
  });

  it('excludes entries outside the date range', () => {
    // Entry within range
    const d1 = createJournalEntry(db, {
      date: '2026-01-15',
      description: 'January revenue',
      lineItems: [
        { accountId: accounts.cash, debitCents: 10000, creditCents: 0 },
        { accountId: accounts.revenue, debitCents: 0, creditCents: 10000 },
      ],
    });
    postJournalEntry(db, d1.id);

    // Entry outside range (February)
    const d2 = createJournalEntry(db, {
      date: '2026-02-01',
      description: 'February revenue',
      lineItems: [
        { accountId: accounts.cash, debitCents: 5000, creditCents: 0 },
        { accountId: accounts.revenue, debitCents: 0, creditCents: 5000 },
      ],
    });
    postJournalEntry(db, d2.id);

    // Only query January
    const is = generateIncomeStatement(db, '2026-01-01', '2026-01-31');
    expect(is.totalRevenueCents).toBe(10000); // Not 15000
  });

  it('returns zero for all sections on an empty ledger', () => {
    const is = generateIncomeStatement(db, '2026-01-01', '2026-01-31');
    expect(is.totalRevenueCents).toBe(0);
    expect(is.totalCogsCents).toBe(0);
    expect(is.totalOperatingExpensesCents).toBe(0);
    expect(is.netIncomeCents).toBe(0);
    expect(is.revenue).toHaveLength(0);
    expect(is.cogs).toHaveLength(0);
    expect(is.operatingExpenses).toHaveLength(0);
  });

  it('excludes draft entries from income statement', () => {
    // Create but do NOT post
    createJournalEntry(db, {
      date: '2026-01-15',
      description: 'Draft revenue — must not appear',
      lineItems: [
        { accountId: accounts.cash, debitCents: 10000, creditCents: 0 },
        { accountId: accounts.revenue, debitCents: 0, creditCents: 10000 },
      ],
    });
    const is = generateIncomeStatement(db, '2026-01-01', '2026-01-31');
    expect(is.totalRevenueCents).toBe(0);
  });
});
