# Demo Guide — Autonomous AI Bookkeeper

## Quick Start (2 minutes)

```bash
# 1. Add your Anthropic API key
echo "ANTHROPIC_API_KEY=sk-ant-your-key-here" > .env.local

# 2. Seed the database (idempotent — safe to run multiple times)
npm run db:seed

# 3. Start the dev server
npm run dev
```

Open **http://localhost:3000** — you'll land on the Transactions page.

---

## Demo Flow (5-10 minutes)

### Step 1: Review Pending Transactions

**Page:** `/transactions`

You'll see 40 bank transactions for "Acme Analytics", a fictional SaaS company. All start as **Pending** (gray badges).

Notice the mix:
- **32 clear transactions** — AWS, Gusto payroll, Stripe fees, GitHub, customer subscriptions
- **8 ambiguous transactions** — "AMZN MKTP US", "JOHN SMITH", "VENMO PAYMENT", "CHECK #1042"

The stat cards at the top show: 40 Total, 40 Pending, 0 Posted, 0 Needs Clarification.

### Step 2: Process All Transactions

**Action:** Click the blue **"Process All"** button.

This triggers the full AI pipeline:

1. **Categorization Agent** (Claude Sonnet) processes each transaction:
   - Recognizable merchants (AWS, Gusto, Stripe) get auto-categorized with high confidence
   - Each categorized transaction gets a balanced double-entry journal entry posted automatically
   - Ambiguous transactions get flagged for human clarification

2. **Comms Agent** (Claude Sonnet) drafts clarification messages for flagged transactions

**Watch the Activity Log** (floating panel, bottom-right) — it shows real-time agent actions with color coding:
- Blue = Categorization Agent actions
- Green = Comms Agent actions

**After processing completes** (~30-60 seconds), the stats update:
- ~32 transactions now show **Posted** (green)
- ~8 transactions show **Needs Clarification** (orange)
- Click any row to expand and see the agent's reasoning

### Step 3: Review Agent Reasoning

**Action:** Click on a posted transaction row to expand it.

Each transaction shows:
- The **category** it was mapped to (e.g., "5100 - Hosting & Cloud Infrastructure" for AWS)
- The **confidence score** (green badge for >85%, yellow for 50-85%)
- The **agent's reasoning** — why it chose that category

This is the observability layer — every classification decision is auditable.

### Step 4: Handle Ambiguous Transactions

**Page:** `/messages`

The left panel shows all transactions needing clarification. Select one (e.g., "AMZN MKTP US $89.99").

The right panel shows the Comms Agent's message — a professional, concise question about the transaction. It states the date, merchant, and amount, explains why clarification is needed, and suggests likely options.

**Action:** Type a response as the business owner. Examples:

| Transaction | Example Response |
|---|---|
| AMZN MKTP US $89.99 | "That was office supplies - ergonomic keyboard for the engineering team" |
| JOHN SMITH $500.00 | "Freelance contractor payment for logo design" |
| TRANSFER FROM SAVINGS $5,000.00 | "Owner capital investment into the business" |
| VENMO PAYMENT $350.00 | "Reimbursement to our office manager for team lunch supplies" |
| UBER $47.32 | "Business trip to client meeting downtown" |
| TARGET $156.78 | "Office supplies - printer paper and toner" |
| PAYPAL TRANSFER $1,200.00 | "Payment to freelance developer for website updates" |
| CHECK #1042 $2,500.00 | "Monthly office equipment lease payment" |

After sending, the Comms Agent:
1. Interprets your response
2. Maps it to the correct chart of accounts category
3. Posts a balanced journal entry
4. Sends a brief thank-you confirmation

The transaction moves from "Needs Clarification" to "Posted".

### Step 5: Review the Ledger

**Page:** `/ledger`

Browse all journal entries. Each card shows:
- Date, description, and status badge
- Expand to see the debit/credit line items
- A checkmark confirming debits = credits (the double-entry invariant)

Use the status filter tabs (All / Draft / Posted / Reversed) to focus.

The summary stats at the top show total entries, total debits, and total credits — these should always match.

### Step 6: View Financial Reports

**Page:** `/reports`

Three tabs:

**Trial Balance**
- Lists every account with its debit and credit totals
- The totals row shows whether the books are balanced
- A balanced trial balance (Total Debits = Total Credits) confirms accounting integrity

**Income Statement**
- Revenue (Stripe subscription payouts)
- minus Cost of Goods Sold (AWS hosting, Stripe fees, support payroll)
- = Gross Profit
- minus Operating Expenses (payroll, rent, tools, marketing)
- = Net Income
- Use the date picker to select Jan-Feb 2026 for the full period

**Balance Sheet**
- Assets = Liabilities + Equity
- The accounting equation is displayed prominently with a green/red indicator
- Shows the impact of all posted transactions on the company's financial position

---

## Troubleshooting

| Issue | Fix |
|---|---|
| "Process All" fails immediately | Check `.env.local` has a valid `ANTHROPIC_API_KEY` |
| Transactions stay "pending" after processing | Check the dev server console for API errors |
| Reports show $0.00 everywhere | Process transactions first — reports read from the ledger |
| Messages page shows "No transactions need clarification" | All transactions are resolved, or processing hasn't run yet |
| Build fails | Run `npm run build` and check for TypeScript errors |

---

## Reset & Re-run

To start fresh:

```bash
rm bookkeeper.db bookkeeper.db-shm bookkeeper.db-wal
npm run db:seed
npm run dev
```

This gives you a clean slate with 40 pending transactions, ready for another demo run.
