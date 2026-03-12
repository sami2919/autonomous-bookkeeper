// Comms agent — handles clarification messages for ambiguous transactions

import { generateText, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { eq } from 'drizzle-orm';
import { db } from '@/db/index';
import { customerMessages, transactions } from '@/db/schema';
import { createChartOfAccountsTools } from '@/tools/chart-of-accounts';
import { createLedgerTools } from '@/tools/ledger';
import { createTransactionTools } from '@/tools/transactions';
import { createMessageTools } from '@/tools/messages';
import { generateCOATable } from '@/lib/prompt-helpers';
import type { ActivityEvent } from '@/lib/types';

function buildOutboundSystemPrompt(coaTable: string): string {
  return `You are a professional bookkeeper for Acme Analytics, a SaaS technology company. Your job is to communicate with the company owner about bank transactions that you couldn't automatically categorize because they were ambiguous.

## Your Role

You need to draft and send clear, professional messages asking the owner to clarify what each flagged transaction was for. The goal is to get enough information to properly categorize the transaction in our accounting records.

## Tone & Style

- **Professional but warm**: You are a trusted advisor, not a robot
- **Concise**: Get to the point quickly — the owner is busy
- **Specific**: Always state the exact date, merchant, and amount
- **Helpful**: Suggest the most likely business purposes so they just need to confirm

## Chart of Accounts

${coaTable}

Use these account categories when suggesting possible purposes to the customer.

## Message Format (follow this structure exactly)

Hi! I came across a transaction that I need your help categorizing:

**[Date] — [Merchant/Description] — $[Amount]**

[One sentence explaining why this is ambiguous — what makes it unclear]

This could be:
- [Most likely option A, e.g., "Office supplies (expense)"]
- [Second likely option B, e.g., "Client entertainment (expense)"]
- [Third option if relevant, e.g., "Something else entirely"]

Could you let me know which of these applies, or describe what this was for?

Thanks!

## Important Rules

1. Call \`getTransaction\` to get the transaction details first
2. Call \`getConversation\` to check if you've already sent a message about this transaction
3. **Only send a message if no agent message exists yet** — do not send duplicate messages
4. Use \`sendMessage\` to send your drafted message
5. Process every transaction in your list — do not skip any

## Amount Formatting

Transaction amounts are stored as integer cents. Positive = expense, negative = income.
- amountCents = 28473 → "$284.73 charge"
- amountCents = -9900 → "$99.00 payment received"

Always display amounts as dollars with 2 decimal places.`;
}

function buildInboundSystemPrompt(coaTable: string): string {
  return `You are an expert SaaS bookkeeper for Acme Analytics. A customer has replied to your clarification request about a bank transaction. Your job is to:

1. Read the full conversation history to understand context
2. Interpret the customer's response to determine the business purpose
3. Map it to the correct chart of accounts category
4. Categorize the transaction and post a balanced journal entry
5. Send a brief, friendly thank-you confirming what you recorded

## Double-Entry Rules

Every journal entry MUST balance: total debits = total credits.

**Expenses (money out — positive amountCents):**
- Debit the expense account (e.g., 5100 Hosting & Cloud Infrastructure)
- Credit 1000 Cash & Cash Equivalents

**Revenue (money in — negative amountCents):**
- Debit 1000 Cash & Cash Equivalents
- Credit the revenue account (e.g., 4100 Subscription Revenue)

**Amount conversion:** Divide amountCents by 100 for dollar amounts. Always use absolute value.

## Chart of Accounts

${coaTable}

## Decision Algorithm

1. Call \`getTransaction\` to get the transaction details (date, amount, merchant)
2. Call \`getConversation\` to read the full conversation history including the customer's reply
3. Interpret the customer's response — extract the business purpose clearly
4. If the account code is unclear, call \`lookupAccounts\` to search for it
5. Call \`categorizeTransaction\` with:
   - The correct accountCode
   - confidence: 90 (customer confirmed)
   - reasoning: what the customer said this was for
6. Call \`postJournalEntry\` with the balanced double-entry (transactionId is required)
7. Call \`sendMessage\` to send a brief thank-you, e.g.:
   "Thanks! I've recorded this as [account name]. Let me know if anything needs correcting."

## Handling Vague or Unclear Responses

If the customer's response is still too vague to categorize:
- Do NOT guess — send another message asking for more specifics
- Do NOT categorize with low confidence if genuinely unsure

## Handling Multi-Transaction Responses

If the customer addresses multiple transactions in one message, process each one
separately using the same algorithm above.`;
}

export interface ClarificationResult {
  totalFlagged: number;
  messagesSent: number;
  alreadyMessaged: number;
  errors: string[];
  events: ActivityEvent[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export interface ResponseResult {
  transactionId: number;
  categorized: boolean;
  posted: boolean;
  replied: boolean;
  errors: string[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export async function generateClarificationMessages(): Promise<ClarificationResult> {
  const flaggedRows = db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.status, 'needs_clarification'))
    .all();

  const totalFlagged = flaggedRows.length;

  if (totalFlagged === 0) {
    return {
      totalFlagged: 0,
      messagesSent: 0,
      alreadyMessaged: 0,
      errors: [],
      events: [],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
  }

  const transactionIds = flaggedRows.map((r) => r.id);

  const { getTransaction } = createTransactionTools(db);
  const { sendMessage, getConversation } = createMessageTools(db);
  const coaTable = generateCOATable(db);

  const maxSteps = Math.ceil(totalFlagged * 3 * 1.2) + 5;

  const result = await generateText({
    model: anthropic('claude-sonnet-4-6'),
    system: buildOutboundSystemPrompt(coaTable),
    prompt:
      `You have ${totalFlagged} bank transactions flagged for customer clarification. ` +
      `Process each one by sending a clear, professional message asking for clarification. ` +
      `\n\nTransaction IDs to process: ${transactionIds.join(', ')}` +
      `\n\nFor each transaction ID: call getTransaction, then getConversation to check if ` +
      `you've already sent a message. If no agent message exists, draft and send one. ` +
      `Do not send duplicate messages. Process all ${totalFlagged} transactions before stopping.`,
    tools: {
      getTransaction,
      sendMessage,
      getConversation,
    },
    stopWhen: stepCountIs(maxSteps),
  });

  const events: ActivityEvent[] = [
    {
      timestamp: new Date().toISOString(),
      agent: 'comms',
      message: `Processing ${totalFlagged} flagged transaction${totalFlagged !== 1 ? 's' : ''} needing clarification`,
    },
  ];

  const summary = result.steps.reduce(
    (acc, step) => {
      const argsByCallId = new Map(
        (step.toolCalls ?? []).map((c) => [
          c.toolCallId,
          (c as { input?: unknown }).input as Record<string, unknown> | undefined,
        ])
      );

      for (const toolResult of step.toolResults ?? []) {
        const r = toolResult.output as { success?: boolean; error?: string };
        if (r?.success === true && toolResult.toolName === 'sendMessage') {
          acc.messagesSent += 1;
          const input = argsByCallId.get(toolResult.toolCallId);
          const txId = input?.transactionId;
          events.push({
            timestamp: new Date().toISOString(),
            agent: 'comms',
            message: `Sent clarification message for transaction #${txId ?? '?'}`,
          });
        }
        if (r?.success === false && r?.error) {
          acc.errors.push(`[${toolResult.toolName}] ${r.error}`);
        }
      }
      return acc;
    },
    { messagesSent: 0, errors: [] as string[] }
  );

  const alreadyMessaged = totalFlagged - summary.messagesSent;
  const inputTokens = result.totalUsage.inputTokens ?? 0;
  const outputTokens = result.totalUsage.outputTokens ?? 0;

  return {
    totalFlagged,
    messagesSent: summary.messagesSent,
    alreadyMessaged: Math.max(0, alreadyMessaged),
    errors: summary.errors,
    events,
    usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
  };
}

export async function handleCustomerResponse(
  transactionId: number,
  customerMessage: string
): Promise<ResponseResult> {
  if (!customerMessage || customerMessage.trim().length === 0) {
    return {
      transactionId,
      categorized: false,
      posted: false,
      replied: false,
      errors: ['Customer message cannot be empty'],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
  }

  const transaction = db
    .select({ id: transactions.id, status: transactions.status })
    .from(transactions)
    .where(eq(transactions.id, transactionId))
    .get();

  if (!transaction) {
    return {
      transactionId,
      categorized: false,
      posted: false,
      replied: false,
      errors: [`Transaction ${transactionId} not found`],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
  }

  if (transaction.status !== 'needs_clarification') {
    return {
      transactionId,
      categorized: false,
      posted: false,
      replied: false,
      errors: [
        `Transaction ${transactionId} has status '${transaction.status}', expected 'needs_clarification'`,
      ],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
  }

  db.insert(customerMessages)
    .values({
      transactionId,
      direction: 'customer',
      content: customerMessage,
    })
    .run();

  const { getTransaction, categorizeTransaction } = createTransactionTools(db);
  const { lookupAccounts } = createChartOfAccountsTools(db);
  const { postJournalEntry } = createLedgerTools(db);
  const { sendMessage, getConversation } = createMessageTools(db);

  const result = await generateText({
    model: anthropic('claude-sonnet-4-6'),
    system: buildInboundSystemPrompt(generateCOATable(db)),
    prompt:
      `A customer has replied about transaction ID ${transactionId}. ` +
      `Read the full conversation history, interpret their response, categorize the ` +
      `transaction with the correct account code, post the balanced journal entry, ` +
      `and send a brief thank-you confirming what you recorded.`,
    tools: {
      getTransaction,
      getConversation,
      lookupAccounts,
      categorizeTransaction,
      postJournalEntry,
      sendMessage,
    },
    stopWhen: stepCountIs(20),
  });

  const summary = result.steps.reduce(
    (acc, step) => {
      for (const toolResult of step.toolResults ?? []) {
        const r = toolResult.output as { success?: boolean; error?: string };
        if (r?.success === true) {
          switch (toolResult.toolName) {
            case 'categorizeTransaction':
              acc.categorized = true;
              break;
            case 'postJournalEntry':
              acc.posted = true;
              break;
            case 'sendMessage':
              acc.replied = true;
              break;
          }
        }
        if (r?.success === false && r?.error) {
          acc.errors.push(`[${toolResult.toolName}] ${r.error}`);
        }
      }
      return acc;
    },
    { categorized: false, posted: false, replied: false, errors: [] as string[] }
  );

  const inputTokens = result.totalUsage.inputTokens ?? 0;
  const outputTokens = result.totalUsage.outputTokens ?? 0;

  return {
    transactionId,
    ...summary,
    usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
  };
}
