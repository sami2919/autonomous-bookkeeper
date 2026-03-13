import { getTransactionsWithAccounts } from "@/lib/queries";
import type { TransactionRow } from "@/components/transaction-table";
import TransactionsClient from "./transactions-client";

export default function TransactionsPage() {
  const rawTransactions = getTransactionsWithAccounts();

  // Map to the shape TransactionTable expects
  const transactions: TransactionRow[] = rawTransactions.map((tx) => ({
    id: tx.id,
    date: tx.date,
    merchantName: tx.merchantName,
    description: tx.description,
    amountCents: tx.amountCents,
    status: tx.status as TransactionRow["status"],
    categoryConfidence: tx.categoryConfidence,
    accountName: tx.accountName,
    accountCode: tx.accountCode,
    agentReasoning: tx.agentReasoning,
  }));

  return <TransactionsClient initialTransactions={transactions} />;
}
