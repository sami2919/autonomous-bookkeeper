// Categorization agent — classifies pending transactions via LLM
// and posts balanced journal entries to the general ledger.

import { generateText, streamText, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { eq } from 'drizzle-orm';
import { db } from '@/db/index';
import { transactions } from '@/db/schema';
import { createChartOfAccountsTools } from '@/tools/chart-of-accounts';
import { createLedgerTools } from '@/tools/ledger';
import { createTransactionTools } from '@/tools/transactions';
import { generateCOATable, getAccountNamesMap } from '@/lib/prompt-helpers';
import type { ActivityEvent } from '@/lib/types';

function buildSystemPrompt(coaTable: string): string {
  return `You are an expert SaaS bookkeeper for a technology company called Acme Analytics. Your job is to categorize bank transactions using double-entry accounting principles and post balanced journal entries to the general ledger.

## Double-Entry Rules

Every journal entry MUST balance: total debits = total credits.

**Expenses (money out — positive amountCents):**
- Debit the expense account (e.g., 5100 Hosting & Cloud Infrastructure)
- Credit 1000 Cash & Cash Equivalents
- Example: $284.73 AWS bill → Debit 5100 $284.73, Credit 1000 $284.73

**Revenue (money in — negative amountCents):**
- Debit 1000 Cash & Cash Equivalents
- Credit the revenue account (e.g., 4100 Subscription Revenue)
- Example: $99.00 Stripe payout (amountCents: -9900) → Debit 1000 $99.00, Credit 4100 $99.00

**Amount conversion:** Transaction amounts are stored as integer cents. Divide by 100 for dollar amounts in journal entries. Use absolute value — always post positive dollar amounts with explicit debit/credit direction.

## Chart of Accounts

${coaTable}

## Known Merchant → Account Mappings

Use these for instant high-confidence categorization:

| Merchant               | Account | Confidence | Reasoning |
|------------------------|---------|------------|-----------|
| Amazon Web Services    | 5100    | 97         | Cloud infra COGS |
| AWS                    | 5100    | 97         | Cloud infra COGS |
| Datadog                | 5100    | 92         | Monitoring is infrastructure COGS |
| Gusto (payroll run)    | 6360    | 97         | HR & Payroll Software |
| GitHub                 | 6220    | 97         | Dev tooling |
| Figma                  | 6220    | 92         | Design/dev tooling |
| Linear                 | 6220    | 90         | Project management / dev tooling |
| Stripe (fees/positive) | 5300    | 97         | Merchant processing COGS |
| Stripe (payout/negative)| 4100   | 97         | Customer subscription revenue |
| Google Ads             | 6130    | 97         | Advertising & marketing |
| Slack                  | 6350    | 97         | SaaS productivity tool |
| Zoom                   | 6350    | 97         | SaaS productivity tool |
| WeWork                 | 6320    | 97         | Office rent |
| State Farm             | 6330    | 97         | Business insurance |

**Stripe disambiguation:** The same merchant "Stripe" appears as both a fee (positive amountCents → 5300) and a payout (negative amountCents → 4100). Always check the sign of amountCents first.

## Confidence Scoring (0–100 integer scale)

Use a **two-tier system** — this aligns with how the categorizeTransaction tool routes work:

- **≥ 80 (High confidence):** Recognizable merchant with a clear account match. Post automatically.
  - Examples: AWS → 97, GitHub → 97, Stripe fees → 97
  - Use the known merchant table above. If the merchant is listed, you can assign 90+ immediately.
- **< 80 (Low confidence):** Ambiguous transaction. Flag for human clarification.
  - Use this when: no merchant name, generic description (e.g. "CHECK #1042"), or the merchant
    could map to multiple accounts (e.g. "TRANSFER FROM SAVINGS" could be revenue or equity).

If you are unsure whether an account code exists, call \`lookupAccounts\` before assigning — this
prevents posting to a non-existent account. A successful lookup can raise your confidence to ≥80.

## Decision Algorithm

1. Call \`getPendingTransactions\` FIRST to fetch all transactions to process.
2. Process each transaction ONE AT A TIME in the order returned.
3. For each transaction:
   a. Look at merchantName and description to identify the vendor.
   b. Assign an account code and confidence score (0–100) using the mappings above.
   c. **Confidence ≥ 80:**
      - Call \`categorizeTransaction\` with the account code, confidence, and your reasoning.
      - Call \`postJournalEntry\` with the balanced double-entry. Always include transactionId.
        Dollar amount = abs(amountCents) / 100 (e.g., amountCents=28473 → dollars=284.73).
   d. **Confidence < 80:**
      - If you want to verify an account code first, call \`lookupAccounts\`. If the result
        confirms the account and raises your confidence to ≥80, proceed to categorize + post.
      - Otherwise, call \`flagForClarification\` with a specific explanation of the ambiguity.
        Example: "No merchant name. JOHN SMITH could be contractor, employee, or personal payment."
4. After processing ALL transactions, stop.

## Quality Standards

- Every \`categorizeTransaction\` reasoning field must explain WHY this account was chosen, not just name the account. This is the audit trail.
- Every journal entry MUST have transactionId set to link it to the source transaction.
- Never leave a transaction unprocessed — every pending transaction must be either categorized+posted OR flagged.
`;
}

export interface CategorizationResult {
  categorized: number;
  posted: number;
  flagged: number;
  /** Transactions the agent didn't reach due to step limit. */
  skipped: number;
  errors: string[];
  events: ActivityEvent[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

const USER_PROMPT =
  'Process all pending bank transactions. ' +
  'Start by calling getPendingTransactions, then categorize each one following the ' +
  'decision algorithm in your system prompt. Do not stop until every pending transaction ' +
  'has been either categorized+posted or flagged for clarification.';

interface PendingRow {
  id: number;
  merchantName: string | null;
  description: string;
  amountCents: number;
}

interface CategorizationPrep {
  tools: {
    lookupAccounts: ReturnType<typeof createChartOfAccountsTools>['lookupAccounts'];
    postJournalEntry: ReturnType<typeof createLedgerTools>['postJournalEntry'];
    categorizeTransaction: ReturnType<typeof createTransactionTools>['categorizeTransaction'];
    flagForClarification: ReturnType<typeof createTransactionTools>['flagForClarification'];
    getPendingTransactions: ReturnType<typeof createTransactionTools>['getPendingTransactions'];
  };
  pendingRows: PendingRow[];
  txMap: Map<number, PendingRow>;
  totalPending: number;
  systemPrompt: string;
  userPrompt: string;
  accountNames: Record<string, string>;
}

// TODO: batch transactions for large datasets
function prepareCategorization(): CategorizationPrep {
  const { lookupAccounts } = createChartOfAccountsTools(db);
  const { postJournalEntry } = createLedgerTools(db);
  const { categorizeTransaction, flagForClarification, getPendingTransactions } =
    createTransactionTools(db);

  const coaTable = generateCOATable(db);
  const accountNames = getAccountNamesMap(db);

  // Fetch full transaction data so we can enrich activity events
  // with merchant names and amounts without additional DB queries post-run.
  const pendingRows = db
    .select({
      id: transactions.id,
      merchantName: transactions.merchantName,
      description: transactions.description,
      amountCents: transactions.amountCents,
    })
    .from(transactions)
    .where(eq(transactions.status, 'pending'))
    .all();

  const txMap = new Map(pendingRows.map((tx) => [tx.id, tx]));

  return {
    tools: { lookupAccounts, postJournalEntry, categorizeTransaction, flagForClarification, getPendingTransactions },
    pendingRows,
    txMap,
    totalPending: pendingRows.length,
    systemPrompt: buildSystemPrompt(coaTable),
    userPrompt: USER_PROMPT,
    accountNames,
  };
}

export async function processPendingTransactions(): Promise<CategorizationResult> {
  const prep = prepareCategorization();

  if (prep.totalPending === 0) {
    return {
      categorized: 0,
      posted: 0,
      flagged: 0,
      skipped: 0,
      errors: [],
      events: [],
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
  }

  const result = await generateText({
    model: anthropic('claude-sonnet-4-6'),
    system: prep.systemPrompt,
    prompt: prep.userPrompt,
    tools: prep.tools,
    // 40 txns x 2 calls + lookups ≈ 91 worst case, 120 gives 30% headroom
    stopWhen: stepCountIs(120),
  });

  const events: ActivityEvent[] = [
    {
      timestamp: new Date().toISOString(),
      agent: 'categorization',
      message: `Fetched ${prep.totalPending} pending transaction${prep.totalPending !== 1 ? 's' : ''}`,
    },
  ];

  const summary = result.steps.reduce(
    (acc, step) => {
      const resultByCallId = new Map(
        (step.toolResults ?? []).map((r) => [r.toolCallId, r.output as { success?: boolean; error?: string }])
      );

      for (const toolCall of step.toolCalls ?? []) {
        const output = resultByCallId.get(toolCall.toolCallId);
        const succeeded = output?.success !== false;

        switch (toolCall.toolName) {
          case 'categorizeTransaction': {
            if (succeeded) {
              acc.categorized += 1;
              const input = (toolCall as { input?: Record<string, unknown> }).input;
              if (input) {
                const txId = input.transactionId as number | undefined;
                const accountCode = (input.accountCode as string | undefined) ?? '';
                const confidence = (input.confidence as number | undefined) ?? 0;
                const tx = txId !== undefined ? prep.txMap.get(txId) : undefined;
                const merchant = tx?.merchantName ?? tx?.description ?? (txId !== undefined ? `Transaction #${txId}` : 'Transaction');
                const amount = tx ? ` $${(Math.abs(tx.amountCents) / 100).toFixed(2)}` : '';
                const accountName = prep.accountNames[accountCode] ?? accountCode;
                events.push({
                  timestamp: new Date().toISOString(),
                  agent: 'categorization',
                  message: `Categorized ${merchant}${amount} as ${accountName} (${confidence}% confidence)`,
                });
              }
            }
            break;
          }
          case 'postJournalEntry': {
            if (succeeded) {
              acc.posted += 1;
              const input = (toolCall as { input?: Record<string, unknown> }).input;
              const description = (input?.description as string | undefined) ?? 'journal entry';
              events.push({
                timestamp: new Date().toISOString(),
                agent: 'categorization',
                message: `Posted journal entry: ${description}`,
              });
            }
            break;
          }
          case 'flagForClarification': {
            acc.flagged += 1;
            if (succeeded) {
              const input = (toolCall as { input?: Record<string, unknown> }).input;
              const txId = input?.transactionId as number | undefined;
              const tx = txId !== undefined ? prep.txMap.get(txId) : undefined;
              const merchant = tx?.merchantName ?? tx?.description ?? (txId !== undefined ? `Transaction #${txId}` : 'Transaction');
              events.push({
                timestamp: new Date().toISOString(),
                agent: 'categorization',
                message: `Flagged ${merchant} for human clarification`,
              });
            }
            break;
          }
        }
      }

      for (const toolResult of step.toolResults ?? []) {
        const r = toolResult.output as { success?: boolean; error?: string };
        if (r?.success === false && r?.error) {
          acc.errors.push(`[${toolResult.toolName}] ${r.error}`);
        }
      }

      return acc;
    },
    { categorized: 0, posted: 0, flagged: 0, errors: [] as string[] }
  );

  const processed = summary.categorized + summary.flagged;
  const skipped = Math.max(0, prep.totalPending - processed);

  if (skipped > 0) {
    events.push({
      timestamp: new Date().toISOString(),
      agent: 'categorization',
      message: `Step limit reached — ${skipped} transaction${skipped !== 1 ? 's' : ''} skipped`,
    });
  }

  const inputTokens = result.totalUsage.inputTokens ?? 0;
  const outputTokens = result.totalUsage.outputTokens ?? 0;

  return {
    ...summary,
    skipped,
    events,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
    },
  };
}

export async function* streamProcessPendingTransactions(): AsyncGenerator<ActivityEvent> {
  const prep = prepareCategorization();

  if (prep.totalPending === 0) {
    return;
  }

  yield {
    timestamp: new Date().toISOString(),
    agent: 'categorization',
    message: `Fetched ${prep.totalPending} pending transaction${prep.totalPending !== 1 ? 's' : ''}`,
  };

  const result = streamText({
    model: anthropic('claude-sonnet-4-6'),
    system: prep.systemPrompt,
    prompt: prep.userPrompt,
    tools: prep.tools,
    stopWhen: stepCountIs(120),
  });

  let categorized = 0;
  let posted = 0;
  let flagged = 0;

  for await (const event of result.fullStream) {
    if (event.type === 'tool-result') {
      const output = event.output as { success?: boolean; error?: string };

      switch (event.toolName) {
        case 'categorizeTransaction': {
          if (output?.success !== false) {
            categorized++;
            const input = event.input as Record<string, unknown>;
            const txId = input?.transactionId as number | undefined;
            const accountCode = (input?.accountCode as string) ?? '';
            const confidence = (input?.confidence as number) ?? 0;
            const tx = txId !== undefined ? prep.txMap.get(txId) : undefined;
            const merchant = tx?.merchantName ?? tx?.description ?? `Transaction #${txId ?? '?'}`;
            const amount = tx ? ` $${(Math.abs(tx.amountCents) / 100).toFixed(2)}` : '';
            const accountName = prep.accountNames[accountCode] ?? accountCode;
            yield {
              timestamp: new Date().toISOString(),
              agent: 'categorization',
              message: `Categorized ${merchant}${amount} as ${accountName} (${confidence}% confidence)`,
            };
          }
          break;
        }
        case 'postJournalEntry': {
          if (output?.success !== false) {
            posted++;
            const input = event.input as Record<string, unknown>;
            const description = (input?.description as string) ?? 'journal entry';
            yield {
              timestamp: new Date().toISOString(),
              agent: 'categorization',
              message: `Posted journal entry: ${description}`,
            };
          }
          break;
        }
        case 'flagForClarification': {
          flagged++;
          if (output?.success !== false) {
            const input = event.input as Record<string, unknown>;
            const txId = input?.transactionId as number | undefined;
            const tx = txId !== undefined ? prep.txMap.get(txId) : undefined;
            const merchant = tx?.merchantName ?? tx?.description ?? `Transaction #${txId ?? '?'}`;
            yield {
              timestamp: new Date().toISOString(),
              agent: 'categorization',
              message: `Flagged ${merchant} for human clarification`,
            };
          }
          break;
        }
      }

      if (output?.success === false && output?.error) {
        yield {
          timestamp: new Date().toISOString(),
          agent: 'categorization',
          message: `Error: ${output.error}`,
        };
      }
    }
  }

  const usage = await result.totalUsage;
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;

  const processed = categorized + flagged;
  const skipped = Math.max(0, prep.totalPending - processed);
  if (skipped > 0) {
    yield {
      timestamp: new Date().toISOString(),
      agent: 'categorization',
      message: `Step limit reached — ${skipped} transaction${skipped !== 1 ? 's' : ''} skipped`,
    };
  }

  const totalTokens = inputTokens + outputTokens;
  const estimatedCost = (inputTokens * 3 / 1_000_000) + (outputTokens * 15 / 1_000_000);
  yield {
    timestamp: new Date().toISOString(),
    agent: 'categorization',
    message: `Processing complete: ${categorized} categorized, ${posted} posted, ${flagged} flagged — ${totalTokens.toLocaleString()} tokens (~$${estimatedCost.toFixed(2)})`,
  };
}
