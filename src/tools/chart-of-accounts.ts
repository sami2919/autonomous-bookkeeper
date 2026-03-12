// Chart of accounts tools — read-only account lookups for agents.

import { tool } from 'ai';
import { z } from 'zod';
import { and, eq, like, or } from 'drizzle-orm';
import type { Db } from '@/lib/accounting';
import { chartOfAccounts } from '@/db/schema';

type AccountRow = {
  id: number;
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  parentId: number | null;
};

export function createChartOfAccountsTools(db: Db) {
  const lookupAccounts = tool({
    description:
      'Search the chart of accounts by account name or account code. ' +
      'Use this to find the right account before posting a journal entry. ' +
      'Returns matching active accounts with their codes, names, and types.',
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .describe(
          'Search term — matched against account name and account code (case-insensitive). ' +
            'Examples: "advertising", "5100", "cash".'
        ),
    }),
    execute: async ({ query }) => {
      try {
        const escaped = query.replace(/%/g, '\\%').replace(/_/g, '\\_');
        const pattern = `%${escaped}%`;
        const results: AccountRow[] = db
          .select({
            id: chartOfAccounts.id,
            code: chartOfAccounts.code,
            name: chartOfAccounts.name,
            type: chartOfAccounts.type,
            parentId: chartOfAccounts.parentId,
          })
          .from(chartOfAccounts)
          .where(
            and(
              eq(chartOfAccounts.isActive, true),
              or(like(chartOfAccounts.name, pattern), like(chartOfAccounts.code, pattern))
            )
          )
          .orderBy(chartOfAccounts.code)
          .all();

        return { accounts: results, count: results.length };
      } catch (error) {
        return {
          accounts: [] as AccountRow[],
          count: 0,
          error: `Failed to search accounts: ${(error as Error).message}`,
        };
      }
    },
  });

  const listAccounts = tool({
    description:
      'List all active accounts from the chart of accounts, grouped by type ' +
      '(asset, liability, equity, revenue, expense). ' +
      'Use this to understand the full account structure before categorizing transactions.',
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const all: AccountRow[] = db
          .select({
            id: chartOfAccounts.id,
            code: chartOfAccounts.code,
            name: chartOfAccounts.name,
            type: chartOfAccounts.type,
            parentId: chartOfAccounts.parentId,
          })
          .from(chartOfAccounts)
          .where(eq(chartOfAccounts.isActive, true))
          .orderBy(chartOfAccounts.code)
          .all();

        const grouped = all.reduce<Record<string, AccountRow[]>>((acc, account) => {
          if (!acc[account.type]) acc[account.type] = [];
          acc[account.type].push(account);
          return acc;
        }, {});

        return { accounts: grouped, totalCount: all.length };
      } catch (error) {
        return {
          accounts: {} as Record<string, AccountRow[]>,
          totalCount: 0,
          error: `Failed to list accounts: ${(error as Error).message}`,
        };
      }
    },
  });

  return { lookupAccounts, listAccounts };
}

export type ChartOfAccountsTools = ReturnType<typeof createChartOfAccountsTools>;
