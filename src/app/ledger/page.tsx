import { getLedgerEntries } from "@/lib/queries";
import type { JournalEntry } from "@/components/journal-entry-card";
import LedgerClient from "./ledger-client";

export default function LedgerPage() {
  const rawEntries = getLedgerEntries();

  // Map DB rows to the shape JournalEntryCard expects
  const entries: JournalEntry[] = rawEntries.map((e) => ({
    id: e.id,
    date: e.date,
    description: e.description,
    status: e.status as JournalEntry["status"],
    transactionId: e.transactionId,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    lineItems: e.lineItems.map((li) => ({
      id: li.id,
      entryId: li.entryId,
      accountId: li.accountId,
      accountCode: li.accountCode,
      accountName: li.accountName,
      debitCents: li.debitCents,
      creditCents: li.creditCents,
    })),
  }));

  return <LedgerClient entries={entries} />;
}
