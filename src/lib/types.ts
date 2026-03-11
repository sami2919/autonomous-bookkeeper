import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import type {
  chartOfAccounts,
  customerMessages,
  journalEntries,
  journalLineItems,
  transactions,
} from '@/db/schema';

export type Account = InferSelectModel<typeof chartOfAccounts>;
export type Transaction = InferSelectModel<typeof transactions>;
export type JournalEntry = InferSelectModel<typeof journalEntries>;
export type JournalLineItem = InferSelectModel<typeof journalLineItems>;
export type CustomerMessage = InferSelectModel<typeof customerMessages>;

export type NewAccount = InferInsertModel<typeof chartOfAccounts>;
export type NewTransaction = InferInsertModel<typeof transactions>;
export type NewJournalEntry = InferInsertModel<typeof journalEntries>;
export type NewJournalLineItem = InferInsertModel<typeof journalLineItems>;
export type NewCustomerMessage = InferInsertModel<typeof customerMessages>;

export type AccountType = Account['type'];
export type TransactionStatus = Transaction['status'];
export type JournalEntryStatus = JournalEntry['status'];
export type MessageDirection = CustomerMessage['direction'];

export type TransactionWithJournal = Transaction & {
  journalEntry: (JournalEntry & { lineItems: JournalLineItem[] }) | null;
};

export type TransactionWithMessages = Transaction & {
  messages: CustomerMessage[];
};

/**
 * Invariant: exactly one of debitCents or creditCents must be > 0.
 */
export type LineItemPayload = {
  accountId: number;
  debitCents: number;
  creditCents: number;
};

export type ActivityEvent = {
  timestamp: string;
  agent: 'categorization' | 'comms';
  message: string;
};

export type JournalEntryPayload = {
  date: string;
  description: string;
  transactionId: number;
  lineItems: [LineItemPayload, LineItemPayload, ...LineItemPayload[]];
};
