/* Orchestrator — sequences agent invocations with no LLM calls of its own. */

import { eq, sql } from 'drizzle-orm';
import { db } from '@/db/index';
import { transactions } from '@/db/schema';
import { processPendingTransactions } from '@/agents/categorization';
import {
  generateClarificationMessages,
  handleCustomerResponse as commsHandleCustomerResponse,
} from '@/agents/comms';
import type { CategorizationResult } from '@/agents/categorization';
import type { ClarificationResult, ResponseResult } from '@/agents/comms';
import type { ActivityEvent } from '@/lib/types';

export interface ProcessingSummary {
  processed: number;
  posted: number;
  flagged: number;
  /** Transactions the categorization agent did not reach (step limit hit). */
  skipped: number;
  messagesSent: number;
  errors: string[];
  events: ActivityEvent[];
  agentResults: {
    categorization: CategorizationResult;
    clarification: ClarificationResult;
  };
}

export interface StatusSummary {
  pending: number;
  categorized: number;
  needs_clarification: number;
  posted: number;
  total: number;
}

export async function processAllTransactions(): Promise<ProcessingSummary> {
  const categorizationResult = await processPendingTransactions();

  // Also run comms in case there are pre-existing flagged transactions
  const clarificationResult = await generateClarificationMessages();

  const allErrors = [...categorizationResult.errors, ...clarificationResult.errors];
  const allEvents = [...categorizationResult.events, ...clarificationResult.events];

  return {
    processed: categorizationResult.categorized + categorizationResult.flagged,
    posted: categorizationResult.posted,
    flagged: categorizationResult.flagged,
    skipped: categorizationResult.skipped,
    messagesSent: clarificationResult.messagesSent,
    errors: allErrors,
    events: allEvents,
    agentResults: {
      categorization: categorizationResult,
      clarification: clarificationResult,
    },
  };
}

export async function handleCustomerResponse(
  transactionId: number,
  message: string
): Promise<ResponseResult> {
  if (!Number.isInteger(transactionId) || transactionId <= 0) {
    return {
      transactionId,
      categorized: false,
      posted: false,
      replied: false,
      errors: ['transactionId must be a positive integer'],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
  }

  return commsHandleCustomerResponse(transactionId, message);
}

export function getProcessingSummary(): StatusSummary {
  const rows = db
    .select({
      status: transactions.status,
      count: sql<number>`count(*)`,
    })
    .from(transactions)
    .groupBy(transactions.status)
    .all();

  const counts: StatusSummary = {
    pending: 0,
    categorized: 0,
    needs_clarification: 0,
    posted: 0,
    total: 0,
  };

  const validStatuses = new Set<string>(['pending', 'categorized', 'needs_clarification', 'posted']);

  for (const row of rows) {
    if (validStatuses.has(row.status)) {
      const status = row.status as keyof Omit<StatusSummary, 'total'>;
      counts[status] = row.count;
    }
    counts.total += row.count;
  }

  return counts;
}
