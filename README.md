# Autonomous AI Bookkeeper

An autonomous bookkeeping system that ingests bank transactions, categorizes them via LLM, maintains a double-entry general ledger, and communicates with customers about ambiguous transactions — without a human bookkeeper in the loop.

---

## Architecture

```
                    ┌──────────────────────────┐
                    │  TypeScript Orchestrator  │  ← state machine, zero LLM calls
                    │  (orchestrator.ts)        │
                    └─────────────┬────────────┘
                                  │
               ┌──────────────────┼──────────────────┐
               ▼                                      ▼
  ┌────────────────────────┐          ┌────────────────────────┐
  │  Categorization Agent  │          │    Comms Agent          │
  │  (categorization.ts)   │          │    (comms.ts)           │
  │                        │          │                         │
  │  Modes:                │          │  Tools:                 │
  │  • generateText (JSON) │          │  • getUnclearedTxns     │
  │  • streamText (SSE)    │          │  • getMessageThread     │
  │                        │          │  • sendMessage          │
  │  Tools:                │          │  • categorizeTransaction│
  │  • getPendingTxns      │          │  • postJournalEntry     │
  │  • lookupAccounts      │          └──────────────┬──────────┘
  │  • categorizeTransaction│                         │
  │  • flagForClarification│                          │
  │  • postJournalEntry    │                          │
  └────────────┬───────────┘                          │
               │                                      │
               ▼                                      ▼
  ┌────────────────────────────────────────────────────────────┐
  │               SQLite + Drizzle ORM (double-entry enforced) │
  │  chart_of_accounts → transactions → journal_entries        │
  │                                  → journal_line_items      │
  │                                  → customer_messages       │
  └────────────────────────────────────────────────────────────┘
               │
               ▼
  ┌────────────────────────┐
  │   Reporting Agent      │  ← pure TypeScript, zero LLM calls
  │   (reporting.ts)       │
  │                        │
  │  Income Statement      │
  │  Balance Sheet         │
  │  Trial Balance         │
  └────────────────────────┘
```

**Pipeline flow:**
1. Bank transactions arrive (mock Plaid-shaped interface)
2. Categorization Agent classifies each transaction with confidence scoring
   - High confidence (≥80): posts a balanced double-entry journal entry automatically
   - Low confidence (<80): flags for human clarification via Comms Agent
   - Supports both blocking (`generateText`) and real-time SSE streaming (`streamText`) modes
3. Comms Agent sends professional messages to the customer, then processes replies to auto-categorize
4. Reporting Agent computes financial statements from the posted ledger (pure math, no LLM)

---

## Setup

### Prerequisites

- Node.js 18+
- An Anthropic API key

### Install

```bash
git clone <this-repo>
cd book-keeping
npm install
```

### Configure

```bash
# Create a .env.local file:
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.local
echo "API_KEY=your-secret-api-key" >> .env.local  # optional; enforced in production
```

### Seed the database

```bash
npm run db:seed
```

This creates `bookkeeper.db` with:
- 20 chart-of-accounts entries (standard SaaS account structure)
- 30 sample bank transactions (a mix of recognizable merchants and ambiguous entries)

### Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — you will land on the Transactions page.

---

## Demo Walkthrough

1. **Transactions page** — See all ingested bank transactions. Click **Process Transactions** to run the AI pipeline. The Activity Log panel (bottom-right) shows **real-time streaming** updates via SSE as each transaction is categorized, posted, or flagged — no waiting for the full batch to complete.

2. **Messages page** — Select a flagged transaction from the left panel. The Comms Agent has already sent a clarification question. Type a reply and send it — the agent interprets your response and auto-categorizes the transaction.

3. **Ledger page** — Browse the general ledger. Every posted journal entry shows its debit and credit line items, linked to the originating transaction and the agent's reasoning.

4. **Reports page** — Generate an Income Statement, Balance Sheet, or Trial Balance for any date range. Reports are computed from the ledger — no LLM involved.

---

## Design Philosophy

The double-entry invariant lives at the data layer, not in any prompt. The `postJournalEntry` tool checks that debits equal credits before writing anything to the database. If an agent produces an unbalanced entry, it gets an error back, self-corrects, and retries. Prompt injection or model drift can't bypass this — accounting correctness is enforced in TypeScript.

LLMs don't do financial arithmetic here. The Reporting Agent is pure TypeScript — it queries the ledger and computes statements deterministically. LLMs are great for classification and natural language, but you wouldn't want one computing a balance sheet that goes to an accountant.

The orchestrator is also LLM-free. It's a TypeScript pipeline that sequences agents, collects results, and surfaces errors. The confidence threshold (>=80 to post, <80 to flag) is enforced by the `categorizeTransaction` tool itself, so it can't drift with prompt changes.

Seed data uses the same field names as Plaid's `/transactions/get` endpoint, so swapping in a real Plaid integration just means implementing the `TransactionProvider` interface.

Agent tools are narrow and safe — each does one thing, write tools validate before writing, and agents can't run arbitrary SQL or access tables directly. When a transaction has low confidence, it doesn't get silently skipped. It enters a `needs_clarification` workflow state, the Comms Agent drafts a message, and it only gets categorized after the customer responds.

The system also accepts natural language from customers, so there's defense-in-depth against prompt injection: Zod schema validation on every tool input, account codes resolved against the chart of accounts, balance checks on every journal entry, confidence thresholds enforced in code, and transaction status guards that prevent re-categorization of already-posted entries. Even if an adversarial message manipulates the LLM's reasoning, the tool layer won't allow invalid state changes.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| LLM | Claude Sonnet via Anthropic API |
| AI SDK | Vercel AI SDK v6 (`generateText` + `streamText` with SSE streaming) |
| Database | SQLite (better-sqlite3) |
| ORM | Drizzle ORM |
| Styling | Tailwind CSS v4 |
| Testing | Vitest (unit + integration) |

---

## Limitations & What Production Would Add

| Area | Current | Production |
|---|---|---|
| Bank connectivity | Mock seed data | Real Plaid integration via `TransactionProvider` |
| Multi-tenancy | Single business (Acme Analytics) | Per-tenant ledger isolation, auth |
| GAAP compliance | Structural double-entry only | Accrual basis, depreciation, matching principle |
| Reconciliation | Not implemented | Bank statement matching, discrepancy flagging |
| Scheduled processing | Manual trigger | Cron-based nightly close, Plaid webhooks |
| Observability | Activity log panel | Structured traces, per-run cost tracking |

---

## Running Tests

```bash
npm test                 # run all tests
npm run test:coverage    # with coverage report
```

The test suite covers accounting invariants (unit) and the full API pipeline (integration).
