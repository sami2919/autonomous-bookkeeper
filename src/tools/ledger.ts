// Ledger tools — write operations for the general ledger (journal entries).

import { tool } from 'ai';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '@/lib/accounting';
import { createJournalEntry, reverseJournalEntry } from '@/lib/accounting';
import { chartOfAccounts, transactions } from '@/db/schema';
import type { JournalEntry, LineItemPayload } from '@/lib/types';

function resolveAccountCode(db: Db, code: string): number {
  const account = db
    .select({ id: chartOfAccounts.id })
    .from(chartOfAccounts)
    .where(and(eq(chartOfAccounts.code, code), eq(chartOfAccounts.isActive, true)))
    .get();

  if (!account) {
    throw new Error(
      `Account code '${code}' not found in chart of accounts. ` +
        `Use lookupAccounts or listAccounts to find the correct code.`
    );
  }

  return account.id;
}

// FIXME: this should probably be configurable
export function dollarsToCents(dollars: number): number {
  if (!Number.isFinite(dollars)) {
    throw new Error(`Dollar amount must be a finite number, got: ${dollars}`);
  }
  // epsilon handles IEEE 754 drift (e.g. 1.005 * 100 = 100.4999...)
  return Math.round(dollars * 100 + 1e-9);
}

type EntrySummary = Pick<JournalEntry, 'id' | 'date' | 'description' | 'status' | 'createdAt'> & {
  transactionId?: number | null;
};

export function createLedgerTools(db: Db) {
  const postJournalEntry = tool({
    description:
      'Create a balanced journal entry in the general ledger. ' +
      'Automatically resolves account codes (e.g. "5100") to database IDs. ' +
      'Amounts are in dollars (e.g. 100.50 for $100.50). ' +
      'The entry must balance: total debits must equal total credits. ' +
      'The entry is created with status "posted" immediately.',
    inputSchema: z.object({
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
        .describe('Transaction date in ISO 8601 format (YYYY-MM-DD)'),
      description: z
        .string()
        .min(1)
        .describe('Human-readable description of what this journal entry records'),
      lines: z
        .array(
          z.object({
            accountCode: z
              .string()
              .min(1)
              .describe('Account code from the chart of accounts (e.g. "1010", "5100")'),
            debit: z
              .number()
              .min(0)
              .describe('Debit amount in dollars. Use 0 if crediting this account.'),
            credit: z
              .number()
              .min(0)
              .describe('Credit amount in dollars. Use 0 if debiting this account.'),
          })
        )
        .min(2)
        .describe(
          'Line items for the entry. Must have at least 2 items. ' +
            'Each line debits or credits one account. ' +
            'Total debits across all lines must equal total credits.'
        ),
      transactionId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('ID of the bank transaction this entry categorizes (omit for adjusting entries)'),
    }),
    execute: async ({ date, description, lines, transactionId }) => {
      try {
        const resolvedLines: LineItemPayload[] = lines.map((line) => ({
          accountId: resolveAccountCode(db, line.accountCode),
          debitCents: dollarsToCents(line.debit),
          creditCents: dollarsToCents(line.credit),
        }));

        const entry = db.transaction(() => {
          const created = createJournalEntry(db, {
            date,
            description,
            lineItems: resolvedLines as [LineItemPayload, LineItemPayload, ...LineItemPayload[]],
            transactionId,
            status: 'posted',
          });

          if (transactionId != null) {
            db.update(transactions)
              .set({ status: 'posted', updatedAt: sql`(datetime('now'))` })
              .where(eq(transactions.id, transactionId))
              .run();
          }

          return created;
        });

        const summary: EntrySummary = {
          id: entry.id,
          date: entry.date,
          description: entry.description,
          status: entry.status,
          transactionId: entry.transactionId,
          createdAt: entry.createdAt,
        };

        return { success: true, entry: summary };
      } catch (error) {
        return {
          success: false,
          error: `Failed to post journal entry: ${(error as Error).message}`,
        };
      }
    },
  });

  const reverseEntry = tool({
    description:
      'Reverse a posted journal entry by creating an offsetting entry that zeroes out its ledger impact. ' +
      'Only posted entries can be reversed (not drafts). ' +
      'The original entry is marked as "reversed" and a new balancing entry is created as "posted". ' +
      'Use this to correct categorization errors after an entry has been posted.',
    inputSchema: z.object({
      entryId: z
        .number()
        .int()
        .positive()
        .describe('ID of the posted journal entry to reverse'),
      reason: z
        .string()
        .min(1)
        .describe(
          'Explanation for why this entry is being reversed — for audit trail purposes'
        ),
    }),
    execute: async ({ entryId, reason }) => {
      try {
        const reversingEntry = reverseJournalEntry(db, entryId, reason);

        const summary: EntrySummary = {
          id: reversingEntry.id,
          date: reversingEntry.date,
          description: reversingEntry.description,
          status: reversingEntry.status,
          createdAt: reversingEntry.createdAt,
        };

        return {
          success: true,
          reason,
          reversedEntryId: entryId,
          reversingEntry: summary,
        };
      } catch (error) {
        return {
          success: false,
          error: `Failed to reverse entry ${entryId}: ${(error as Error).message}`,
        };
      }
    },
  });

  return { postJournalEntry, reverseEntry };
}

export type LedgerTools = ReturnType<typeof createLedgerTools>;
