// Shared read-only queries used by API routes and tests.

import { eq, inArray } from 'drizzle-orm';
import { db } from '@/db/index';
import {
  transactions,
  chartOfAccounts,
  journalEntries,
  journalLineItems,
  customerMessages,
} from '@/db/schema';

type TransactionStatus = 'pending' | 'categorized' | 'needs_clarification' | 'posted';

export function getTransactionsWithAccounts(status?: TransactionStatus) {
  const baseQuery = db
    .select({
      id: transactions.id,
      externalId: transactions.externalId,
      date: transactions.date,
      merchantName: transactions.merchantName,
      description: transactions.description,
      amountCents: transactions.amountCents,
      categoryConfidence: transactions.categoryConfidence,
      status: transactions.status,
      accountId: transactions.accountId,
      accountName: chartOfAccounts.name,
      accountCode: chartOfAccounts.code,
      agentReasoning: transactions.agentReasoning,
      createdAt: transactions.createdAt,
      updatedAt: transactions.updatedAt,
    })
    .from(transactions)
    .leftJoin(chartOfAccounts, eq(transactions.accountId, chartOfAccounts.id));

  return status
    ? baseQuery.where(eq(transactions.status, status)).limit(500).all()
    : baseQuery.limit(500).all();
}

export function getLedgerEntries(transactionId?: number) {
  const entries = transactionId
    ? db.select().from(journalEntries).where(eq(journalEntries.transactionId, transactionId)).all()
    : db.select().from(journalEntries).limit(500).all();

  if (entries.length === 0) {
    return [];
  }

  const entryIds = entries.map((e) => e.id);

  const lineItemRows = db
    .select({
      id: journalLineItems.id,
      entryId: journalLineItems.entryId,
      accountId: journalLineItems.accountId,
      accountCode: chartOfAccounts.code,
      accountName: chartOfAccounts.name,
      debitCents: journalLineItems.debitCents,
      creditCents: journalLineItems.creditCents,
    })
    .from(journalLineItems)
    .leftJoin(chartOfAccounts, eq(journalLineItems.accountId, chartOfAccounts.id))
    .where(inArray(journalLineItems.entryId, entryIds))
    .all();

  const lineItemsByEntry = new Map<number, typeof lineItemRows>();
  for (const row of lineItemRows) {
    const existing = lineItemsByEntry.get(row.entryId) ?? [];
    existing.push(row);
    lineItemsByEntry.set(row.entryId, existing);
  }

  return entries.map((entry) => ({
    ...entry,
    lineItems: lineItemsByEntry.get(entry.id) ?? [],
  }));
}

export function getMessagesForTransaction(transactionId: number) {
  return db
    .select()
    .from(customerMessages)
    .where(eq(customerMessages.transactionId, transactionId))
    .orderBy(customerMessages.createdAt)
    .all();
}
