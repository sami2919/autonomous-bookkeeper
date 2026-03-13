import { getTransactionsWithAccounts } from "@/lib/queries";
import MessagesClient from "./messages-client";

export default function MessagesPage() {
  const rawTransactions = getTransactionsWithAccounts("needs_clarification");

  // Map to the shape the client component expects
  const flaggedTransactions = rawTransactions.map((tx) => ({
    id: tx.id,
    date: tx.date,
    merchantName: tx.merchantName,
    description: tx.description,
    amountCents: tx.amountCents,
    status: tx.status,
  }));

  return <MessagesClient initialTransactions={flaggedTransactions} />;
}
