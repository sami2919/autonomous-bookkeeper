import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';

export const chartOfAccounts = sqliteTable('chart_of_accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  type: text('type', {
    enum: ['asset', 'liability', 'equity', 'revenue', 'expense'],
  }).notNull(),
  parentId: integer('parent_id').references((): AnySQLiteColumn => chartOfAccounts.id),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
});

export const transactions = sqliteTable('transactions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  externalId: text('external_id').notNull().unique(), // idempotency key from bank
  date: text('date').notNull(),
  merchantName: text('merchant_name'),
  description: text('description').notNull(),
  // Integer cents to avoid floating-point errors. Positive = expense, negative = income.
  amountCents: integer('amount_cents').notNull(),
  categoryConfidence: integer('category_confidence'), // 0-100
  status: text('status', {
    enum: ['pending', 'categorized', 'needs_clarification', 'posted'],
  })
    .notNull()
    .default('pending'),
  accountId: integer('account_id').references(() => chartOfAccounts.id),
  agentReasoning: text('agent_reasoning'),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const journalEntries = sqliteTable('journal_entries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  date: text('date').notNull(),
  description: text('description').notNull(),
  status: text('status', {
    enum: ['draft', 'posted', 'reversed'],
  })
    .notNull()
    .default('draft'),
  transactionId: integer('transaction_id')
    .references(() => transactions.id)
    .unique(),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

// Each entry has >= 2 line items. SUM(debitCents) must equal SUM(creditCents).
export const journalLineItems = sqliteTable('journal_line_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  entryId: integer('entry_id')
    .notNull()
    .references(() => journalEntries.id, { onDelete: 'cascade' }),
  accountId: integer('account_id')
    .notNull()
    .references(() => chartOfAccounts.id),
  debitCents: integer('debit_cents').notNull().default(0),
  creditCents: integer('credit_cents').notNull().default(0),
});

export const customerMessages = sqliteTable('customer_messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  transactionId: integer('transaction_id')
    .notNull()
    .references(() => transactions.id),
  direction: text('direction', {
    enum: ['agent', 'customer'],
  }).notNull(),
  content: text('content').notNull(),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const chartOfAccountsRelations = relations(
  chartOfAccounts,
  ({ one, many }) => ({
    parent: one(chartOfAccounts, {
      fields: [chartOfAccounts.parentId],
      references: [chartOfAccounts.id],
      relationName: 'accountHierarchy',
    }),
    children: many(chartOfAccounts, { relationName: 'accountHierarchy' }),
    transactions: many(transactions),
    journalLineItems: many(journalLineItems),
  })
);

export const transactionsRelations = relations(transactions, ({ one, many }) => ({
  account: one(chartOfAccounts, {
    fields: [transactions.accountId],
    references: [chartOfAccounts.id],
  }),
  journalEntry: one(journalEntries, {
    fields: [transactions.id],
    references: [journalEntries.transactionId],
  }),
  customerMessages: many(customerMessages),
}));

export const journalEntriesRelations = relations(journalEntries, ({ one, many }) => ({
  transaction: one(transactions, {
    fields: [journalEntries.transactionId],
    references: [transactions.id],
  }),
  lineItems: many(journalLineItems),
}));

export const journalLineItemsRelations = relations(journalLineItems, ({ one }) => ({
  entry: one(journalEntries, {
    fields: [journalLineItems.entryId],
    references: [journalEntries.id],
  }),
  account: one(chartOfAccounts, {
    fields: [journalLineItems.accountId],
    references: [chartOfAccounts.id],
  }),
}));

export const customerMessagesRelations = relations(customerMessages, ({ one }) => ({
  transaction: one(transactions, {
    fields: [customerMessages.transactionId],
    references: [transactions.id],
  }),
}));
