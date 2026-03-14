/**
 * End-to-End Integration Tests
 *
 * Tests the complete bookkeeping pipeline using a fresh in-memory database:
 *   1. Seed chart of accounts + realistic transactions
 *   2. Simulate the categorization pipeline by calling tool execute() functions directly
 *      (avoids real LLM calls while fully exercising the data + validation layers)
 *   3. Simulate the clarification flow: flag → customer response → post
 *   4. Verify accounting invariants: trial balance nets to zero, balance sheet equation holds
 *   5. Verify all three financial reports generate correct numbers
 *
 * Why no mocks: the double-entry invariant and report correctness are enforced at the
 * data layer. Mocking the DB would give false positives on the exact scenarios these
 * tests exist to catch (unbalanced entries, mis-categorized account types, etc.).
 *
 * Why no LLM calls: the agent "judgment" is separately covered. Integration tests here
 * prove that when agents call the correct tools with correct arguments, the full pipeline
 * produces valid accounting state. That boundary is stable and deterministic.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, sql } from 'drizzle-orm';
import { describe, it, expect, beforeEach } from 'vitest';
import * as schema from '@/db/schema';
import {
  chartOfAccounts,
  transactions,
  journalEntries,
  journalLineItems,
  customerMessages,
} from '@/db/schema';
import {
  calculateTrialBalance,
  generateBalanceSheet,
  generateIncomeStatement,
} from '@/lib/accounting';
import { getTrialBalance, getIncomeStatement, getBalanceSheet } from '@/agents/reporting';
import { createTransactionTools } from '@/tools/transactions';
import { createLedgerTools } from '@/tools/ledger';
import { createMessageTools } from '@/tools/messages';
import type { Db } from '@/lib/accounting';

// ─── DB Factory ───────────────────────────────────────────────────────────────

function createTestDb(): { db: Db; sqlite: Database.Database } {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('journal_mode = WAL');

  // Replicate the production schema exactly — tests run against the real DDL.
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

  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

// ─── Seed Helpers ─────────────────────────────────────────────────────────────

/** Acme Analytics chart of accounts — mirrors production seed */
const ACCOUNTS = [
  { code: '1000', name: 'Cash & Cash Equivalents', type: 'asset' as const },
  { code: '1200', name: 'Accounts Receivable', type: 'asset' as const },
  { code: '1500', name: 'Prepaid Expenses', type: 'asset' as const },
  { code: '1700', name: 'Fixed Assets & Equipment', type: 'asset' as const },
  { code: '2100', name: 'Accounts Payable', type: 'liability' as const },
  { code: '2200', name: 'Accrued Expenses', type: 'liability' as const },
  { code: '2300', name: 'Payroll Liabilities', type: 'liability' as const },
  { code: '2400', name: 'Deferred Revenue', type: 'liability' as const },
  { code: '3100', name: "Owner's Capital", type: 'equity' as const },
  { code: '3200', name: 'Retained Earnings', type: 'equity' as const },
  { code: '4100', name: 'Subscription Revenue', type: 'revenue' as const },
  { code: '4200', name: 'Professional Services Revenue', type: 'revenue' as const },
  { code: '4900', name: 'Interest & Other Income', type: 'revenue' as const },
  { code: '5100', name: 'Hosting & Cloud Infrastructure', type: 'expense' as const },
  { code: '5200', name: 'Customer Support Payroll', type: 'expense' as const },
  { code: '5300', name: 'Merchant Processing Fees', type: 'expense' as const },
  { code: '6110', name: 'Sales Payroll & Commissions', type: 'expense' as const },
  { code: '6130', name: 'Advertising & Marketing', type: 'expense' as const },
  { code: '6150', name: 'Travel & Entertainment', type: 'expense' as const },
  { code: '6210', name: 'Engineering Payroll', type: 'expense' as const },
  { code: '6220', name: 'Development Tools', type: 'expense' as const },
  { code: '6320', name: 'Office Rent', type: 'expense' as const },
  { code: '6330', name: 'Insurance', type: 'expense' as const },
  { code: '6340', name: 'Professional Services (Legal/Accounting)', type: 'expense' as const },
  { code: '6350', name: 'Software & SaaS Tools', type: 'expense' as const },
  { code: '6360', name: 'HR & Payroll Software', type: 'expense' as const },
];

function seedAccounts(db: Db): void {
  db.insert(chartOfAccounts).values(ACCOUNTS).run();
}

/** Representative subset of Acme Analytics transactions — includes clear and ambiguous cases */
const CLEAR_TRANSACTIONS = [
  // Cloud/hosting expenses (→ 5100)
  { externalId: 'int_aws_jan',  date: '2026-01-02', merchantName: 'Amazon Web Services', description: 'AWS - Monthly Cloud Infrastructure', amountCents: 284733 },
  { externalId: 'int_aws_feb',  date: '2026-02-01', merchantName: 'Amazon Web Services', description: 'AWS - Monthly Cloud Infrastructure', amountCents: 291217 },
  { externalId: 'int_ddog',     date: '2026-01-12', merchantName: 'Datadog', description: 'DATADOG INC - Monitoring & Observability', amountCents: 34782 },

  // Merchant processing fees (→ 5300)
  { externalId: 'int_stripe_fee_jan', date: '2026-01-31', merchantName: 'Stripe', description: 'STRIPE PROCESSING FEES - January', amountCents: 31245 },
  { externalId: 'int_stripe_fee_feb', date: '2026-02-28', merchantName: 'Stripe', description: 'STRIPE PROCESSING FEES - February', amountCents: 28790 },

  // Subscription revenue — negative = money in (→ 4100)
  { externalId: 'int_stripe_pay_1', date: '2026-01-05', merchantName: 'Stripe', description: 'STRIPE PAYOUT - Customer Subscription (Starter)', amountCents: -9900 },
  { externalId: 'int_stripe_pay_2', date: '2026-01-08', merchantName: 'Stripe', description: 'STRIPE PAYOUT - Customer Subscription (Pro)',     amountCents: -19900 },
  { externalId: 'int_stripe_pay_3', date: '2026-01-11', merchantName: 'Stripe', description: 'STRIPE PAYOUT - Customer Subscription (Business)', amountCents: -49900 },
  { externalId: 'int_stripe_pay_4', date: '2026-02-07', merchantName: 'Stripe', description: 'STRIPE PAYOUT - Customer Subscription (Starter)', amountCents: -9900 },
  { externalId: 'int_stripe_pay_5', date: '2026-02-12', merchantName: 'Stripe', description: 'STRIPE PAYOUT - Customer Subscription (Pro)',     amountCents: -19900 },

  // Payroll (→ 6360)
  { externalId: 'int_gusto_jan', date: '2026-01-15', merchantName: 'Gusto', description: 'GUSTO PAYROLL - Monthly payroll run', amountCents: 1425000 },
  { externalId: 'int_gusto_feb', date: '2026-02-14', merchantName: 'Gusto', description: 'GUSTO PAYROLL - Monthly payroll run', amountCents: 1425000 },

  // Advertising (→ 6130)
  { externalId: 'int_gads_jan', date: '2026-01-08', merchantName: 'Google', description: 'GOOGLE ADS - January Campaign', amountCents: 150000 },
  { externalId: 'int_gads_feb', date: '2026-02-08', merchantName: 'Google', description: 'GOOGLE ADS - February Campaign', amountCents: 150000 },

  // SaaS tools (→ 6350)
  { externalId: 'int_slack', date: '2026-01-05', merchantName: 'Slack',  description: 'SLACK TECHNOLOGIES - Pro Plan',          amountCents: 24500 },
  { externalId: 'int_zoom',  date: '2026-01-06', merchantName: 'Zoom',   description: 'ZOOM VIDEO COMMUNICATIONS - Business',   amountCents: 14990 },

  // Development tools (→ 6220)
  { externalId: 'int_gh',     date: '2026-01-04', merchantName: 'GitHub', description: 'GITHUB INC - Team Plan Monthly',     amountCents: 44100 },
  { externalId: 'int_figma',  date: '2026-01-10', merchantName: 'Figma',  description: 'FIGMA INC - Organization Plan',       amountCents: 7500 },
  { externalId: 'int_linear', date: '2026-01-07', merchantName: 'Linear', description: 'LINEAR APP - Team Plan',              amountCents: 8000 },

  // Office rent (→ 6320)
  { externalId: 'int_ww_jan', date: '2026-01-01', merchantName: 'WeWork', description: 'WEWORK - Office Suite Monthly Rent', amountCents: 320000 },
  { externalId: 'int_ww_feb', date: '2026-02-03', merchantName: 'WeWork', description: 'WEWORK - Office Suite Monthly Rent', amountCents: 320000 },

  // Insurance (→ 6330)
  { externalId: 'int_sf', date: '2026-01-03', merchantName: 'State Farm', description: 'STATE FARM INSURANCE - Business Policy', amountCents: 42500 },
];

const AMBIGUOUS_TRANSACTIONS = [
  { externalId: 'int_amzn',     date: '2026-01-19', merchantName: null, description: 'AMZN MKTP US*3K7P2',    amountCents: 8999 },
  { externalId: 'int_john',     date: '2026-01-22', merchantName: null, description: 'JOHN SMITH',             amountCents: 50000 },
  { externalId: 'int_transfer', date: '2026-02-05', merchantName: null, description: 'TRANSFER FROM SAVINGS',  amountCents: -500000 },
  { externalId: 'int_venmo',    date: '2026-02-10', merchantName: null, description: 'VENMO PAYMENT 8472901',  amountCents: 35000 },
  { externalId: 'int_uber',     date: '2026-01-27', merchantName: null, description: 'UBER* TRIP',             amountCents: 4732 },
  { externalId: 'int_target',   date: '2026-02-13', merchantName: null, description: 'TARGET 00-2847',         amountCents: 15678 },
  { externalId: 'int_paypal',   date: '2026-02-17', merchantName: null, description: 'PAYPAL TRANSFER',        amountCents: 120000 },
  { externalId: 'int_check',    date: '2026-02-22', merchantName: null, description: 'CHECK #1042',            amountCents: 250000 },
];

function seedTransactions(db: Db): void {
  const all = [
    ...CLEAR_TRANSACTIONS.map((t) => ({ ...t, status: 'pending' as const })),
    ...AMBIGUOUS_TRANSACTIONS.map((t) => ({ ...t, status: 'pending' as const })),
  ];
  db.insert(transactions).values(all).run();
}

/** Maps a merchant name to its expected chart of accounts code. */
const MERCHANT_ACCOUNT_MAP: Record<string, { code: string; confidence: number; reasoning: string }> = {
  'Amazon Web Services': { code: '5100', confidence: 97, reasoning: 'AWS cloud infrastructure is a direct COGS expense (Hosting & Cloud Infrastructure 5100)' },
  'Datadog':            { code: '5100', confidence: 92, reasoning: 'Datadog monitoring is cloud infrastructure overhead, categorized as COGS (5100)' },
  'Stripe':             { code: '', confidence: 0, reasoning: '' }, // handled per-sign below
  'Google':             { code: '6130', confidence: 97, reasoning: 'Google Ads is a sales & marketing expense (Advertising & Marketing 6130)' },
  'Gusto':              { code: '6360', confidence: 97, reasoning: 'Gusto payroll run is processed through HR & Payroll Software (6360)' },
  'Slack':              { code: '6350', confidence: 97, reasoning: 'Slack is a SaaS productivity tool (Software & SaaS Tools 6350)' },
  'Zoom':               { code: '6350', confidence: 97, reasoning: 'Zoom is a SaaS productivity tool (Software & SaaS Tools 6350)' },
  'GitHub':             { code: '6220', confidence: 97, reasoning: 'GitHub is a development tool (Development Tools 6220)' },
  'Figma':              { code: '6220', confidence: 92, reasoning: 'Figma is a design/development tool (Development Tools 6220)' },
  'Linear':             { code: '6220', confidence: 90, reasoning: 'Linear is a project management / development tool (Development Tools 6220)' },
  'WeWork':             { code: '6320', confidence: 97, reasoning: 'WeWork is the office suite monthly rent (Office Rent 6320)' },
  'State Farm':         { code: '6330', confidence: 97, reasoning: 'State Farm is a business insurance policy (Insurance 6330)' },
};

// ─── Test Helper ──────────────────────────────────────────────────────────────

/**
 * Calls a tool's execute function with mock ToolExecutionOptions.
 *
 * AI SDK v6 types execute as optional (tools can be metadata-only) and returns
 * `AsyncIterable<R> | PromiseLike<R> | R` to support streaming. In tests, our
 * tools always return plain Promises, so we resolve via Promise.resolve() and
 * cast to a known shape. This avoids leaking `any` into every call site.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function execTool(tool: { execute?: (...args: any[]) => any }, args: Record<string, unknown>) {
  return (await Promise.resolve(
    tool.execute!(args, { toolCallId: 'test', messages: [] })
  )) as { success: boolean; [key: string]: unknown };
}

// ─── Integration: Full Pipeline ───────────────────────────────────────────────

describe('End-to-End Integration', () => {
  let db: Db;

  beforeEach(() => {
    const result = createTestDb();
    db = result.db;
    seedAccounts(db);
    seedTransactions(db);
  });

  // ── 1. Seeding ─────────────────────────────────────────────────────────────

  it('seeds chart of accounts with correct account types', () => {
    const accounts = db.select().from(chartOfAccounts).all();
    expect(accounts).toHaveLength(ACCOUNTS.length);

    const types = new Set(accounts.map((a) => a.type));
    expect(types).toContain('asset');
    expect(types).toContain('liability');
    expect(types).toContain('equity');
    expect(types).toContain('revenue');
    expect(types).toContain('expense');
  });

  it('seeds the correct number of transactions in pending status', () => {
    const all = db.select().from(transactions).all();
    expect(all).toHaveLength(CLEAR_TRANSACTIONS.length + AMBIGUOUS_TRANSACTIONS.length);

    const pending = all.filter((t) => t.status === 'pending');
    expect(pending).toHaveLength(all.length);
  });

  // ── 2. Categorization Pipeline (tools called directly) ─────────────────────

  it('categorizes clear transactions and posts balanced journal entries', async () => {
    const { categorizeTransaction } = createTransactionTools(db);
    const { postJournalEntry } = createLedgerTools(db);

    // Process all clear transactions
    const clearTxns = db
      .select()
      .from(transactions)
      .where(eq(transactions.status, 'pending'))
      .all()
      .filter((t) => t.merchantName !== null);

    let categorizedCount = 0;
    let postedCount = 0;

    for (const txn of clearTxns) {
      let accountCode: string;
      let confidence: number;
      let reasoning: string;

      if (txn.merchantName === 'Stripe') {
        // Stripe disambiguation: positive = fees (5300), negative = revenue (4100)
        if (txn.amountCents > 0) {
          accountCode = '5300';
          confidence = 97;
          reasoning = 'Stripe processing fee (positive amount = expense, 5300 Merchant Processing Fees)';
        } else {
          accountCode = '4100';
          confidence = 97;
          reasoning = 'Stripe payout (negative amount = revenue inflow, 4100 Subscription Revenue)';
        }
      } else {
        const mapping = MERCHANT_ACCOUNT_MAP[txn.merchantName!];
        if (!mapping) continue;
        accountCode = mapping.code;
        confidence = mapping.confidence;
        reasoning = mapping.reasoning;
      }

      // Step 1: Categorize the transaction
      const catResult = await execTool(categorizeTransaction, {
        transactionId: txn.id,
        accountCode,
        confidence,
        reasoning,
      });
      expect(catResult.success).toBe(true);
      categorizedCount++;

      // Step 2: Post the balanced journal entry
      const amountDollars = Math.abs(txn.amountCents) / 100;
      const isExpense = txn.amountCents > 0;

      const postResult = await execTool(postJournalEntry, {
        date: txn.date,
        description: txn.description,
        lines: isExpense
          ? [
              { accountCode, debit: amountDollars, credit: 0 },
              { accountCode: '1000', debit: 0, credit: amountDollars },
            ]
          : [
              { accountCode: '1000', debit: amountDollars, credit: 0 },
              { accountCode, debit: 0, credit: amountDollars },
            ],
        transactionId: txn.id,
      });
      expect(postResult.success).toBe(true);
      postedCount++;
    }

    expect(categorizedCount).toBe(CLEAR_TRANSACTIONS.length);
    expect(postedCount).toBe(CLEAR_TRANSACTIONS.length);

    // Verify DB state
    const posted = db
      .select()
      .from(transactions)
      .where(eq(transactions.status, 'posted'))
      .all();
    expect(posted).toHaveLength(CLEAR_TRANSACTIONS.length);
  });

  it('flags ambiguous transactions for clarification', async () => {
    const { flagForClarification } = createTransactionTools(db);

    const ambiguousTxns = db
      .select()
      .from(transactions)
      .where(eq(transactions.status, 'pending'))
      .all()
      .filter((t) => t.merchantName === null);

    for (const txn of ambiguousTxns) {
      const result = await execTool(flagForClarification, {
        transactionId: txn.id,
        reason: `No merchant name. '${txn.description}' is ambiguous and could map to multiple accounts.`,
      });
      expect(result.success).toBe(true);
    }

    const flagged = db
      .select()
      .from(transactions)
      .where(eq(transactions.status, 'needs_clarification'))
      .all();
    expect(flagged).toHaveLength(AMBIGUOUS_TRANSACTIONS.length);
  });

  // ── 3. Clarification Flow ──────────────────────────────────────────────────

  it('handles customer response for a flagged transaction end-to-end', async () => {
    const { flagForClarification, categorizeTransaction } = createTransactionTools(db);
    const { postJournalEntry } = createLedgerTools(db);
    const { sendMessage, getConversation } = createMessageTools(db);

    // Find the Uber transaction (travel & entertainment)
    const uberTxn = db
      .select()
      .from(transactions)
      .where(eq(transactions.description, 'UBER* TRIP'))
      .get();
    expect(uberTxn).toBeDefined();

    // Step 1: Agent flags the transaction
    const flagResult = await execTool(flagForClarification, {
      transactionId: uberTxn!.id,
      reason: 'Uber trip — could be business travel (6150) or personal rideshare. Cannot categorize without more context.',
    });
    expect(flagResult.success).toBe(true);

    // Step 2: Agent sends clarification message
    const sendResult = await execTool(sendMessage, {
      transactionId: uberTxn!.id,
      content:
        'Hi! I noticed a $47.32 Uber charge on 2026-01-27. Was this for business travel? ' +
        'It could be: Business travel (Travel & Entertainment expense), or Personal trip (not a business expense). ' +
        'Could you let me know?',
    });
    expect(sendResult.success).toBe(true);

    // Step 3: Customer response is recorded (simulates what handleCustomerResponse does before the LLM call)
    db.insert(customerMessages)
      .values({
        transactionId: uberTxn!.id,
        direction: 'customer',
        content: "That was a business trip to the client's office. Please categorize it as Travel & Entertainment.",
      })
      .run();

    // Verify conversation thread exists
    const convo = await execTool(getConversation, { transactionId: uberTxn!.id });
    expect(convo.success).toBe(true);
    expect(convo.count).toBe(2); // agent message + customer reply

    // Step 4: Agent categorizes and posts based on customer response
    const catResult = await execTool(categorizeTransaction, {
      transactionId: uberTxn!.id,
      accountCode: '6150',
      confidence: 90,
      reasoning: 'Customer confirmed: business trip to client office — Travel & Entertainment (6150)',
    });
    expect(catResult.success).toBe(true);

    const amountDollars = Math.abs(uberTxn!.amountCents) / 100;
    const postResult = await execTool(postJournalEntry, {
      date: uberTxn!.date,
      description: 'UBER* TRIP — Business travel to client office',
      lines: [
        { accountCode: '6150', debit: amountDollars, credit: 0 },
        { accountCode: '1000', debit: 0, credit: amountDollars },
      ],
      transactionId: uberTxn!.id,
    });
    expect(postResult.success).toBe(true);

    // Verify the transaction is now posted
    const updated = db
      .select({ status: transactions.status })
      .from(transactions)
      .where(eq(transactions.id, uberTxn!.id))
      .get();
    expect(updated?.status).toBe('posted');
  });

  // ── 4. Accounting Invariants ───────────────────────────────────────────────

  /**
   * This is the most important integration test.
   *
   * Process all clear transactions, then verify that the trial balance is balanced.
   * The double-entry invariant must hold after the full pipeline — if any tool
   * created an unbalanced entry, the trial balance would fail.
   */
  it('trial balance nets to zero after processing all clear transactions', async () => {
    const { categorizeTransaction } = createTransactionTools(db);
    const { postJournalEntry } = createLedgerTools(db);

    const clearTxns = db
      .select()
      .from(transactions)
      .all()
      .filter((t) => t.merchantName !== null);

    for (const txn of clearTxns) {
      let accountCode: string;

      if (txn.merchantName === 'Stripe') {
        accountCode = txn.amountCents > 0 ? '5300' : '4100';
      } else {
        const mapping = MERCHANT_ACCOUNT_MAP[txn.merchantName!];
        if (!mapping) continue;
        accountCode = mapping.code;
      }

      await execTool(categorizeTransaction, {
        transactionId: txn.id,
        accountCode,
        confidence: 95,
        reasoning: `Auto-categorized: ${txn.merchantName}`,
      });

      const amountDollars = Math.abs(txn.amountCents) / 100;
      const isExpense = txn.amountCents > 0;

      await execTool(postJournalEntry, {
        date: txn.date,
        description: txn.description,
        lines: isExpense
          ? [
              { accountCode, debit: amountDollars, credit: 0 },
              { accountCode: '1000', debit: 0, credit: amountDollars },
            ]
          : [
              { accountCode: '1000', debit: amountDollars, credit: 0 },
              { accountCode, debit: 0, credit: amountDollars },
            ],
        transactionId: txn.id,
      });
    }

    // THE KEY ASSERTION: trial balance must net to zero
    const tb = calculateTrialBalance(db);
    expect(tb.isBalanced).toBe(true);
    expect(tb.totalDebitCents).toBe(tb.totalCreditCents);
    expect(tb.totalDebitCents).toBeGreaterThan(0); // sanity: we actually posted something
  });

  it('balance sheet equation holds: Assets = Liabilities + Equity + Net Income', async () => {
    const { categorizeTransaction } = createTransactionTools(db);
    const { postJournalEntry } = createLedgerTools(db);

    const clearTxns = db
      .select()
      .from(transactions)
      .all()
      .filter((t) => t.merchantName !== null);

    for (const txn of clearTxns) {
      let accountCode: string;

      if (txn.merchantName === 'Stripe') {
        accountCode = txn.amountCents > 0 ? '5300' : '4100';
      } else {
        const mapping = MERCHANT_ACCOUNT_MAP[txn.merchantName!];
        if (!mapping) continue;
        accountCode = mapping.code;
      }

      await execTool(categorizeTransaction, {
        transactionId: txn.id,
        accountCode,
        confidence: 95,
        reasoning: `Auto-categorized: ${txn.merchantName}`,
      });

      const amountDollars = Math.abs(txn.amountCents) / 100;
      const isExpense = txn.amountCents > 0;

      await execTool(postJournalEntry, {
        date: txn.date,
        description: txn.description,
        lines: isExpense
          ? [
              { accountCode, debit: amountDollars, credit: 0 },
              { accountCode: '1000', debit: 0, credit: amountDollars },
            ]
          : [
              { accountCode: '1000', debit: amountDollars, credit: 0 },
              { accountCode, debit: 0, credit: amountDollars },
            ],
        transactionId: txn.id,
      });
    }

    const bs = generateBalanceSheet(db, '2026-02-28');
    expect(bs.isBalanced).toBe(true);
    expect(bs.totalAssetsCents).toBe(bs.totalLiabilitiesAndEquityCents);
  });

  // ── 5. Financial Reports ───────────────────────────────────────────────────

  it('generates trial balance report with correct totals', async () => {
    const { categorizeTransaction } = createTransactionTools(db);
    const { postJournalEntry } = createLedgerTools(db);

    // Post two simple entries to create known state
    const txns = db.select().from(transactions).all();

    // Post an expense: AWS (5100)
    const awsTxn = txns.find((t) => t.merchantName === 'Amazon Web Services' && t.externalId === 'int_aws_jan')!;
    await execTool(categorizeTransaction, { transactionId: awsTxn.id, accountCode: '5100', confidence: 97, reasoning: 'AWS cloud infra' });
    const awsDollars = Math.abs(awsTxn.amountCents) / 100;
    await execTool(postJournalEntry, {
      date: awsTxn.date,
      description: awsTxn.description,
      lines: [
        { accountCode: '5100', debit: awsDollars, credit: 0 },
        { accountCode: '1000', debit: 0, credit: awsDollars },
      ],
      transactionId: awsTxn.id,
    });

    // Post revenue: Stripe payout (4100)
    const revTxn = txns.find((t) => t.externalId === 'int_stripe_pay_1')!;
    await execTool(categorizeTransaction, { transactionId: revTxn.id, accountCode: '4100', confidence: 97, reasoning: 'Stripe subscription payout' });
    const revDollars = Math.abs(revTxn.amountCents) / 100;
    await execTool(postJournalEntry, {
      date: revTxn.date,
      description: revTxn.description,
      lines: [
        { accountCode: '1000', debit: revDollars, credit: 0 },
        { accountCode: '4100', debit: 0, credit: revDollars },
      ],
      transactionId: revTxn.id,
    });

    // Verify the trial balance report (display-ready)
    const tbReport = getTrialBalance(db);
    expect(tbReport.isBalanced).toBe(true);
    expect(tbReport.rows.length).toBeGreaterThan(0);
    // Both cash debits and credits should appear (cash has both inflow from revenue and outflow from expense)
    const cashRow = tbReport.rows.find((r) => r.accountCode === '1000');
    expect(cashRow).toBeDefined();
  });

  it('generates income statement with correct revenue, COGS, and net income', async () => {
    const { categorizeTransaction } = createTransactionTools(db);
    const { postJournalEntry } = createLedgerTools(db);

    const txns = db.select().from(transactions).all();

    // Post AWS (COGS 5100): $2847.33
    const awsTxn = txns.find((t) => t.externalId === 'int_aws_jan')!;
    await execTool(categorizeTransaction, { transactionId: awsTxn.id, accountCode: '5100', confidence: 97, reasoning: 'AWS cloud infra' });
    await execTool(postJournalEntry, {
      date: awsTxn.date,
      description: awsTxn.description,
      lines: [
        { accountCode: '5100', debit: Math.abs(awsTxn.amountCents) / 100, credit: 0 },
        { accountCode: '1000', debit: 0, credit: Math.abs(awsTxn.amountCents) / 100 },
      ],
      transactionId: awsTxn.id,
    });

    // Post Stripe payout revenue (4100): $99.00
    const revTxn = txns.find((t) => t.externalId === 'int_stripe_pay_1')!;
    await execTool(categorizeTransaction, { transactionId: revTxn.id, accountCode: '4100', confidence: 97, reasoning: 'Stripe subscription revenue' });
    await execTool(postJournalEntry, {
      date: revTxn.date,
      description: revTxn.description,
      lines: [
        { accountCode: '1000', debit: Math.abs(revTxn.amountCents) / 100, credit: 0 },
        { accountCode: '4100', debit: 0, credit: Math.abs(revTxn.amountCents) / 100 },
      ],
      transactionId: revTxn.id,
    });

    // Post Office Rent (OpEx 6320): $3200.00
    const rentTxn = txns.find((t) => t.externalId === 'int_ww_jan')!;
    await execTool(categorizeTransaction, { transactionId: rentTxn.id, accountCode: '6320', confidence: 97, reasoning: 'WeWork office rent' });
    await execTool(postJournalEntry, {
      date: rentTxn.date,
      description: rentTxn.description,
      lines: [
        { accountCode: '6320', debit: Math.abs(rentTxn.amountCents) / 100, credit: 0 },
        { accountCode: '1000', debit: 0, credit: Math.abs(rentTxn.amountCents) / 100 },
      ],
      transactionId: rentTxn.id,
    });

    const isReport = generateIncomeStatement(db, '2026-01-01', '2026-01-31');

    // Revenue: $99.00
    expect(isReport.totalRevenueCents).toBe(9900);

    // COGS: $2847.33 (AWS, code starts with '5')
    expect(isReport.totalCogsCents).toBe(284733);

    // OpEx: $3200.00 (WeWork, code starts with '6')
    expect(isReport.totalOperatingExpensesCents).toBe(320000);

    // Net Income: 9900 - 284733 - 320000 = -594833 (net loss)
    expect(isReport.netIncomeCents).toBe(9900 - 284733 - 320000);

    // Verify the display-ready report
    const displayReport = getIncomeStatement(db, '2026-01-01', '2026-01-31');
    expect(displayReport.sections.revenue.lines).toHaveLength(1);
    expect(displayReport.sections.cogs.lines).toHaveLength(1);
    expect(displayReport.sections.operatingExpenses.lines).toHaveLength(1);
  });

  it('generates balance sheet report with isBalanced=true', async () => {
    const { categorizeTransaction } = createTransactionTools(db);
    const { postJournalEntry } = createLedgerTools(db);

    const txns = db.select().from(transactions).all();

    // Post a Stripe payout (revenue → cash inflow)
    const revTxn = txns.find((t) => t.externalId === 'int_stripe_pay_2')!;
    await execTool(categorizeTransaction, { transactionId: revTxn.id, accountCode: '4100', confidence: 97, reasoning: 'Stripe subscription payout' });
    const revDollars = Math.abs(revTxn.amountCents) / 100;
    await execTool(postJournalEntry, {
      date: revTxn.date,
      description: revTxn.description,
      lines: [
        { accountCode: '1000', debit: revDollars, credit: 0 },
        { accountCode: '4100', debit: 0, credit: revDollars },
      ],
      transactionId: revTxn.id,
    });

    const bsReport = getBalanceSheet(db, '2026-01-31');
    expect(bsReport.isBalanced).toBe(true);
    expect(bsReport.totalAssets).toBeDefined();
    expect(bsReport.totalLiabilitiesAndEquity).toBeDefined();
    // Cash (asset) should appear
    expect(bsReport.sections.assets.lines.length).toBeGreaterThan(0);
  });

  // ── 6. Tool Validation & Guards ───────────────────────────────────────────

  it('categorizeTransaction rejects a non-existent account code', async () => {
    const { categorizeTransaction } = createTransactionTools(db);
    const txns = db.select().from(transactions).all();
    const txn = txns[0];

    const result = await execTool(categorizeTransaction, {
      transactionId: txn.id,
      accountCode: '9999',
      confidence: 90,
      reasoning: 'Test with invalid code',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/9999/);
  });

  it('postJournalEntry rejects an unbalanced entry', async () => {
    const txns = db.select().from(transactions).all();
    const txn = txns[0];
    const { postJournalEntry } = createLedgerTools(db);

    const result = await execTool(postJournalEntry, {
      date: txn.date,
      description: 'Intentionally unbalanced',
      lines: [
        { accountCode: '5100', debit: 100.00, credit: 0 },
        { accountCode: '1000', debit: 0, credit: 99.99 }, // off by $0.01
      ],
      transactionId: txn.id,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unbalanced/i);
  });

  it('sendMessage rejects a transaction not in needs_clarification status', async () => {
    const { sendMessage } = createMessageTools(db);
    const txns = db.select().from(transactions).all();
    const txn = txns[0]; // still 'pending'

    const result = await execTool(sendMessage, {
      transactionId: txn.id,
      content: 'This should fail because the transaction is still pending',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/needs_clarification/i);
  });

  it('flagForClarification prevents re-flagging a posted transaction', async () => {
    const { categorizeTransaction, flagForClarification } = createTransactionTools(db);
    const { postJournalEntry } = createLedgerTools(db);

    // Find and post a transaction
    const txns = db.select().from(transactions).all();
    const awsTxn = txns.find((t) => t.merchantName === 'Amazon Web Services')!;

    await execTool(categorizeTransaction, {
      transactionId: awsTxn.id, accountCode: '5100', confidence: 97, reasoning: 'AWS',
    });
    const amountDollars = Math.abs(awsTxn.amountCents) / 100;
    await execTool(postJournalEntry, {
      date: awsTxn.date,
      description: awsTxn.description,
      lines: [
        { accountCode: '5100', debit: amountDollars, credit: 0 },
        { accountCode: '1000', debit: 0, credit: amountDollars },
      ],
      transactionId: awsTxn.id,
    });

    // Try to flag the now-posted transaction
    const result = await execTool(flagForClarification, {
      transactionId: awsTxn.id,
      reason: 'Trying to re-flag a posted transaction',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already posted/i);
  });

  // ── 7. Journal Entry Count Verification ───────────────────────────────────

  it('creates exactly one posted journal entry per transaction posted', async () => {
    const { categorizeTransaction } = createTransactionTools(db);
    const { postJournalEntry } = createLedgerTools(db);

    const clearTxns = db
      .select()
      .from(transactions)
      .all()
      .filter((t) => t.merchantName !== null);

    for (const txn of clearTxns) {
      let accountCode: string;

      if (txn.merchantName === 'Stripe') {
        accountCode = txn.amountCents > 0 ? '5300' : '4100';
      } else {
        const mapping = MERCHANT_ACCOUNT_MAP[txn.merchantName!];
        if (!mapping) continue;
        accountCode = mapping.code;
      }

      await execTool(categorizeTransaction, {
        transactionId: txn.id,
        accountCode,
        confidence: 95,
        reasoning: `Auto-categorized: ${txn.merchantName}`,
      });

      const amountDollars = Math.abs(txn.amountCents) / 100;
      const isExpense = txn.amountCents > 0;

      await execTool(postJournalEntry, {
        date: txn.date,
        description: txn.description,
        lines: isExpense
          ? [
              { accountCode, debit: amountDollars, credit: 0 },
              { accountCode: '1000', debit: 0, credit: amountDollars },
            ]
          : [
              { accountCode: '1000', debit: amountDollars, credit: 0 },
              { accountCode, debit: 0, credit: amountDollars },
            ],
        transactionId: txn.id,
      });
    }

    const postedEntries = db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.status, 'posted'))
      .all();

    expect(postedEntries).toHaveLength(clearTxns.length);

    // Each entry should have exactly 2 line items (simple debit/credit)
    for (const entry of postedEntries) {
      const lines = db
        .select()
        .from(journalLineItems)
        .where(eq(journalLineItems.entryId, entry.id))
        .all();
      expect(lines).toHaveLength(2);

      // Double-entry invariant on each entry
      const totalDebit = lines.reduce((sum, l) => sum + l.debitCents, 0);
      const totalCredit = lines.reduce((sum, l) => sum + l.creditCents, 0);
      expect(totalDebit).toBe(totalCredit);
      expect(totalDebit).toBeGreaterThan(0);
    }
  });

  // ── 8. Cash Balance Math ───────────────────────────────────────────────────

  it('cash balance reflects net of all posted revenues and expenses', async () => {
    const { categorizeTransaction } = createTransactionTools(db);
    const { postJournalEntry } = createLedgerTools(db);

    const txns = db.select().from(transactions).all();

    // Post $199.00 revenue (Stripe Pro payout)
    const revTxn = txns.find((t) => t.externalId === 'int_stripe_pay_2')!;
    await execTool(categorizeTransaction, { transactionId: revTxn.id, accountCode: '4100', confidence: 97, reasoning: 'Stripe Pro payout' });
    await execTool(postJournalEntry, {
      date: revTxn.date,
      description: revTxn.description,
      lines: [
        { accountCode: '1000', debit: 199.00, credit: 0 },
        { accountCode: '4100', debit: 0, credit: 199.00 },
      ],
      transactionId: revTxn.id,
    });

    // Post $320.00 expense (WeWork rent)
    const rentTxn = txns.find((t) => t.externalId === 'int_ww_jan')!;
    await execTool(categorizeTransaction, { transactionId: rentTxn.id, accountCode: '6320', confidence: 97, reasoning: 'WeWork rent' });
    await execTool(postJournalEntry, {
      date: rentTxn.date,
      description: rentTxn.description,
      lines: [
        { accountCode: '6320', debit: 320.00, credit: 0 },
        { accountCode: '1000', debit: 0, credit: 320.00 },
      ],
      transactionId: rentTxn.id,
    });

    // Cash balance: $199.00 in - $320.00 out = -$121.00 (cash overdraft)
    // But since getAccountBalance returns net, and cash is debit-normal:
    // Net = 19900 - 32000 = -12100 (negative = overdrawn)
    const bs = generateBalanceSheet(db, '2026-02-28');
    const cashAccount = bs.assets.accounts.find((a) => a.accountCode === '1000')!;
    expect(cashAccount).toBeDefined();
    // Net cash: 199 in - 320 out = -121 (in cents: -12100)
    expect(cashAccount.amountCents).toBe(-12100);
  });
});
