// Transaction tools — read/write access to bank transactions for agents.

import { tool } from 'ai';
import { z } from 'zod';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '@/lib/accounting';
import { transactions, chartOfAccounts } from '@/db/schema';

type TransactionRow = {
  id: number;
  externalId: string;
  date: string;
  merchantName: string | null;
  description: string;
  amountCents: number;
  categoryConfidence: number | null;
  status: 'pending' | 'categorized' | 'needs_clarification' | 'posted';
  accountId: number | null;
  agentReasoning: string | null;
  createdAt: string;
  updatedAt: string;
};

function resolveAccountCode(db: Db, code: string): number | null {
  const account = db
    .select({ id: chartOfAccounts.id })
    .from(chartOfAccounts)
    .where(and(eq(chartOfAccounts.code, code), eq(chartOfAccounts.isActive, true)))
    .get();

  return account?.id ?? null;
}

export function createTransactionTools(db: Db) {
  const getTransaction = tool({
    description:
      'Get the full details of a single bank transaction by its ID. ' +
      'Returns all fields including status, categorization, and agent reasoning.',
    inputSchema: z.object({
      transactionId: z
        .number()
        .int()
        .positive()
        .describe('The database ID of the transaction to retrieve'),
    }),
    execute: async ({ transactionId }) => {
      try {
        const transaction: TransactionRow | undefined = db
          .select()
          .from(transactions)
          .where(eq(transactions.id, transactionId))
          .get() as TransactionRow | undefined;

        if (!transaction) {
          return { success: false, error: `Transaction ${transactionId} not found` };
        }

        return { success: true, transaction };
      } catch (error) {
        return {
          success: false,
          error: `Failed to fetch transaction ${transactionId}: ${(error as Error).message}`,
        };
      }
    },
  });

  const categorizeTransaction = tool({
    description:
      'Categorize a pending bank transaction by assigning it to a chart of accounts account. ' +
      'Updates the transaction status to "categorized" and records the agent\'s confidence and reasoning. ' +
      'The accountCode must exist in the chart of accounts — use lookupAccounts to verify first.',
    inputSchema: z.object({
      transactionId: z
        .number()
        .int()
        .positive()
        .describe('The database ID of the transaction to categorize'),
      accountCode: z
        .string()
        .min(1)
        .describe(
          'Account code from the chart of accounts to assign this transaction to (e.g. "5100" for Hosting & Cloud Infrastructure, "6130" for Advertising & Marketing)'
        ),
      confidence: z
        .number()
        .int()
        .min(0)
        .max(100)
        .describe(
          'Confidence score 0–100 for this categorization. ' +
            'High confidence (≥80) proceeds automatically; low confidence routes to human review.'
        ),
      reasoning: z
        .string()
        .min(1)
        .describe(
          'Chain-of-thought explanation for why this account was chosen — stored for auditability'
        ),
    }),
    execute: async ({ transactionId, accountCode, confidence, reasoning }) => {
      try {
        if (confidence < 80) {
          return {
            success: false,
            error:
              `Confidence ${confidence} is below the 80-point threshold for automatic posting. ` +
              `Call flagForClarification instead to route this transaction to human review.`,
          };
        }

        const accountId = resolveAccountCode(db, accountCode);
        if (accountId === null) {
          return {
            success: false,
            error:
              `Account code '${accountCode}' not found or inactive. ` +
              `Use lookupAccounts to find the correct code.`,
          };
        }

        const result = db
          .update(transactions)
          .set({
            status: 'categorized',
            accountId,
            categoryConfidence: confidence,
            agentReasoning: reasoning,
            updatedAt: sql`(datetime('now'))`,
          })
          .where(
            and(
              eq(transactions.id, transactionId),
              inArray(transactions.status, ['pending', 'needs_clarification'])
            )
          )
          .run();

        if (result.changes === 0) {
          const existing = db
            .select({ status: transactions.status })
            .from(transactions)
            .where(eq(transactions.id, transactionId))
            .get();

          if (!existing) {
            return { success: false, error: `Transaction ${transactionId} not found` };
          }

          return {
            success: false,
            error:
              `Transaction ${transactionId} has status '${existing.status}' and cannot be categorized. ` +
              `Only 'pending' or 'needs_clarification' transactions can be categorized.`,
          };
        }

        const updated = db
          .select()
          .from(transactions)
          .where(eq(transactions.id, transactionId))
          .get() as TransactionRow;

        return { success: true, transaction: updated };
      } catch (error) {
        return {
          success: false,
          error: `Failed to categorize transaction ${transactionId}: ${(error as Error).message}`,
        };
      }
    },
  });

  const flagForClarification = tool({
    description:
      'Flag a transaction as needing customer clarification. ' +
      'Sets the transaction status to "needs_clarification" and records the reason. ' +
      'Use this when the transaction is ambiguous and cannot be confidently categorized.',
    inputSchema: z.object({
      transactionId: z
        .number()
        .int()
        .positive()
        .describe('The database ID of the transaction that needs clarification'),
      reason: z
        .string()
        .min(1)
        .describe(
          'Explanation of why this transaction is ambiguous — stored as agent reasoning for the audit trail'
        ),
    }),
    execute: async ({ transactionId, reason }) => {
      try {
        // Allow categorized as source state: agent may reconsider after seeing more context.
        // Posted is excluded — must reverse the journal entry instead.
        const result = db
          .update(transactions)
          .set({
            status: 'needs_clarification',
            agentReasoning: reason,
            updatedAt: sql`(datetime('now'))`,
          })
          .where(
            and(
              eq(transactions.id, transactionId),
              inArray(transactions.status, ['pending', 'categorized', 'needs_clarification'])
            )
          )
          .run();

        if (result.changes === 0) {
          const existing = db
            .select({ status: transactions.status })
            .from(transactions)
            .where(eq(transactions.id, transactionId))
            .get();

          if (!existing) {
            return { success: false, error: `Transaction ${transactionId} not found` };
          }

          return {
            success: false,
            error: `Transaction ${transactionId} is already posted and cannot be flagged for clarification.`,
          };
        }

        const updated = db
          .select()
          .from(transactions)
          .where(eq(transactions.id, transactionId))
          .get() as TransactionRow;

        return { success: true, transaction: updated };
      } catch (error) {
        return {
          success: false,
          error: `Failed to flag transaction ${transactionId}: ${(error as Error).message}`,
        };
      }
    },
  });

  const getPendingTransactions = tool({
    description:
      'Retrieve all bank transactions that are waiting to be categorized (status = "pending"). ' +
      'Returns transactions ordered by date ascending so the oldest are processed first.',
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const pending = db
          .select()
          .from(transactions)
          .where(eq(transactions.status, 'pending'))
          .orderBy(transactions.date)
          .all() as TransactionRow[];

        return { success: true, transactions: pending, count: pending.length };
      } catch (error) {
        return {
          success: false,
          transactions: [] as TransactionRow[],
          count: 0,
          error: `Failed to fetch pending transactions: ${(error as Error).message}`,
        };
      }
    },
  });

  return { getTransaction, categorizeTransaction, flagForClarification, getPendingTransactions };
}

export type TransactionTools = ReturnType<typeof createTransactionTools>;
