import { sqlite } from './index';

// Standard SaaS Chart of Accounts for "Acme Analytics"
const ACCOUNTS = [
  { code: '1000', name: 'Cash & Cash Equivalents',       type: 'asset'     as const },
  { code: '1200', name: 'Accounts Receivable',            type: 'asset'     as const },
  { code: '1500', name: 'Prepaid Expenses',               type: 'asset'     as const },
  { code: '1700', name: 'Fixed Assets & Equipment',       type: 'asset'     as const },
  { code: '1750', name: 'Accumulated Depreciation',       type: 'asset'     as const },

  { code: '2100', name: 'Accounts Payable',               type: 'liability' as const },
  { code: '2200', name: 'Accrued Expenses',               type: 'liability' as const },
  { code: '2300', name: 'Payroll Liabilities',            type: 'liability' as const },
  { code: '2400', name: 'Deferred Revenue',               type: 'liability' as const },
  { code: '2500', name: 'Sales Tax Payable',              type: 'liability' as const },

  { code: '3100', name: "Owner's Capital",                type: 'equity'    as const },
  { code: '3200', name: 'Retained Earnings',              type: 'equity'    as const },

  { code: '4100', name: 'Subscription Revenue',           type: 'revenue'   as const },
  { code: '4200', name: 'Professional Services Revenue',  type: 'revenue'   as const },
  { code: '4900', name: 'Interest & Other Income',        type: 'revenue'   as const },

  // COGS (5xxx) — direct costs affecting gross margin
  { code: '5100', name: 'Hosting & Cloud Infrastructure', type: 'expense'   as const },
  { code: '5200', name: 'Customer Support Payroll',       type: 'expense'   as const },
  { code: '5300', name: 'Merchant Processing Fees',       type: 'expense'   as const },

  // Operating expenses (6xxx)
  { code: '6110', name: 'Sales Payroll & Commissions',   type: 'expense'   as const },
  { code: '6130', name: 'Advertising & Marketing',       type: 'expense'   as const },
  { code: '6150', name: 'Travel & Entertainment',        type: 'expense'   as const },
  { code: '6210', name: 'Engineering Payroll',            type: 'expense'   as const },
  { code: '6220', name: 'Development Tools',              type: 'expense'   as const },
  { code: '6320', name: 'Office Rent',                    type: 'expense'   as const },
  { code: '6330', name: 'Insurance',                      type: 'expense'   as const },
  { code: '6340', name: 'Professional Services (Legal/Accounting)', type: 'expense' as const },
  { code: '6350', name: 'Software & SaaS Tools',          type: 'expense'   as const },
  { code: '6360', name: 'HR & Payroll Software',          type: 'expense'   as const },
  { code: '6370', name: 'Depreciation Expense',           type: 'expense'   as const },
] satisfies Array<{ code: string; name: string; type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' }>;

export async function seedChartOfAccounts(): Promise<void> {
  const insert = sqlite.prepare(
    `INSERT OR IGNORE INTO chart_of_accounts (code, name, type, is_active)
     VALUES (?, ?, ?, 1)`
  );
  for (const account of ACCOUNTS) {
    insert.run(account.code, account.name, account.type);
  }

  const count = sqlite
    .prepare(`SELECT COUNT(*) as count FROM chart_of_accounts`)
    .get() as { count: number };
  console.log(`Chart of accounts seeded: ${count.count} accounts total`);
}

// 40 transactions for "Acme Analytics" spanning Jan-Feb 2026
const TRANSACTIONS: Array<{
  externalId: string;
  date: string;
  merchantName: string | null;
  description: string;
  amountCents: number;
}> = [
  // Clear expenses
  { externalId: 'acme_20260102_001', date: '2026-01-02', merchantName: 'Amazon Web Services', description: 'AWS - Monthly Cloud Infrastructure', amountCents: 284733 },
  { externalId: 'acme_20260201_001', date: '2026-02-01', merchantName: 'Amazon Web Services', description: 'AWS - Monthly Cloud Infrastructure', amountCents: 291217 },
  { externalId: 'acme_20260112_001', date: '2026-01-12', merchantName: 'Datadog', description: 'DATADOG INC - Monitoring & Observability', amountCents: 34782 },

  { externalId: 'acme_20260115_001', date: '2026-01-15', merchantName: 'Gusto', description: 'GUSTO PAYROLL - Monthly payroll run', amountCents: 1425000 },
  { externalId: 'acme_20260214_001', date: '2026-02-14', merchantName: 'Gusto', description: 'GUSTO PAYROLL - Monthly payroll run', amountCents: 1425000 },

  { externalId: 'acme_20260131_001', date: '2026-01-31', merchantName: 'Stripe', description: 'STRIPE PROCESSING FEES - January', amountCents: 31245 },
  { externalId: 'acme_20260228_001', date: '2026-02-28', merchantName: 'Stripe', description: 'STRIPE PROCESSING FEES - February', amountCents: 28790 },

  { externalId: 'acme_20260108_001', date: '2026-01-08', merchantName: 'Google', description: 'GOOGLE ADS - January Campaign', amountCents: 150000 },
  { externalId: 'acme_20260208_001', date: '2026-02-08', merchantName: 'Google', description: 'GOOGLE ADS - February Campaign', amountCents: 150000 },

  { externalId: 'acme_20260105_001', date: '2026-01-05', merchantName: 'Slack', description: 'SLACK TECHNOLOGIES - Pro Plan', amountCents: 24500 },
  { externalId: 'acme_20260106_001', date: '2026-01-06', merchantName: 'Zoom', description: 'ZOOM VIDEO COMMUNICATIONS - Business', amountCents: 14990 },

  { externalId: 'acme_20260101_001', date: '2026-01-01', merchantName: 'WeWork', description: 'WEWORK - Office Suite Monthly Rent', amountCents: 320000 },
  { externalId: 'acme_20260203_001', date: '2026-02-03', merchantName: 'WeWork', description: 'WEWORK - Office Suite Monthly Rent', amountCents: 320000 },

  { externalId: 'acme_20260104_001', date: '2026-01-04', merchantName: 'GitHub', description: 'GITHUB INC - Team Plan Monthly', amountCents: 44100 },
  { externalId: 'acme_20260110_001', date: '2026-01-10', merchantName: 'Figma', description: 'FIGMA INC - Organization Plan', amountCents: 7500 },
  { externalId: 'acme_20260107_001', date: '2026-01-07', merchantName: 'Linear', description: 'LINEAR APP - Team Plan', amountCents: 8000 },

  { externalId: 'acme_20260103_001', date: '2026-01-03', merchantName: 'State Farm', description: 'STATE FARM INSURANCE - Business Policy', amountCents: 42500 },

  // Revenue (negative = money in)
  { externalId: 'acme_20260105_002', date: '2026-01-05', merchantName: 'Stripe', description: 'STRIPE PAYOUT - Customer Subscription (Starter)', amountCents: -9900 },
  { externalId: 'acme_20260108_002', date: '2026-01-08', merchantName: 'Stripe', description: 'STRIPE PAYOUT - Customer Subscription (Pro)', amountCents: -19900 },
  { externalId: 'acme_20260111_001', date: '2026-01-11', merchantName: 'Stripe', description: 'STRIPE PAYOUT - Customer Subscription (Business)', amountCents: -49900 },
  { externalId: 'acme_20260114_001', date: '2026-01-14', merchantName: 'Stripe', description: 'STRIPE PAYOUT - Customer Subscription (Starter)', amountCents: -9900 },
  { externalId: 'acme_20260117_001', date: '2026-01-17', merchantName: 'Stripe', description: 'STRIPE PAYOUT - Customer Subscription (Pro)', amountCents: -19900 },
  { externalId: 'acme_20260120_001', date: '2026-01-20', merchantName: 'Stripe', description: 'STRIPE PAYOUT - Customer Subscription (Business)', amountCents: -49900 },
  { externalId: 'acme_20260123_001', date: '2026-01-23', merchantName: 'Stripe', description: 'STRIPE PAYOUT - Customer Subscription (Starter)', amountCents: -9900 },
  { externalId: 'acme_20260125_001', date: '2026-01-25', merchantName: 'Stripe', description: 'STRIPE PAYOUT - Customer Subscription (Pro)', amountCents: -19900 },
  { externalId: 'acme_20260128_001', date: '2026-01-28', merchantName: 'Stripe', description: 'STRIPE PAYOUT - Customer Subscription (Business)', amountCents: -49900 },
  { externalId: 'acme_20260207_001', date: '2026-02-07', merchantName: 'Stripe', description: 'STRIPE PAYOUT - Customer Subscription (Starter)', amountCents: -9900 },
  { externalId: 'acme_20260212_001', date: '2026-02-12', merchantName: 'Stripe', description: 'STRIPE PAYOUT - Customer Subscription (Pro)', amountCents: -19900 },
  { externalId: 'acme_20260216_001', date: '2026-02-16', merchantName: 'Stripe', description: 'STRIPE PAYOUT - Customer Subscription (Starter)', amountCents: -9900 },
  { externalId: 'acme_20260220_001', date: '2026-02-20', merchantName: 'Stripe', description: 'STRIPE PAYOUT - Customer Subscription (Pro)', amountCents: -19900 },
  { externalId: 'acme_20260224_001', date: '2026-02-24', merchantName: 'Stripe', description: 'STRIPE PAYOUT - Customer Subscription (Starter)', amountCents: -9900 },
  { externalId: 'acme_20260226_001', date: '2026-02-26', merchantName: 'Stripe', description: 'STRIPE PAYOUT - Customer Subscription (Business)', amountCents: -49900 },

  // Ambiguous transactions (no merchant name)
  { externalId: 'acme_20260119_001', date: '2026-01-19', merchantName: null, description: 'AMZN MKTP US*3K7P2', amountCents: 8999 },
  { externalId: 'acme_20260122_001', date: '2026-01-22', merchantName: null, description: 'JOHN SMITH', amountCents: 50000 },
  { externalId: 'acme_20260205_001', date: '2026-02-05', merchantName: null, description: 'TRANSFER FROM SAVINGS', amountCents: -500000 },
  { externalId: 'acme_20260210_001', date: '2026-02-10', merchantName: null, description: 'VENMO PAYMENT 8472901', amountCents: 35000 },
  { externalId: 'acme_20260127_001', date: '2026-01-27', merchantName: null, description: 'UBER* TRIP', amountCents: 4732 },
  { externalId: 'acme_20260213_001', date: '2026-02-13', merchantName: null, description: 'TARGET 00-2847', amountCents: 15678 },
  { externalId: 'acme_20260217_001', date: '2026-02-17', merchantName: null, description: 'PAYPAL TRANSFER', amountCents: 120000 },
  { externalId: 'acme_20260222_001', date: '2026-02-22', merchantName: null, description: 'CHECK #1042', amountCents: 250000 },
];

export async function seedTransactions(): Promise<void> {
  const insert = sqlite.prepare(
    `INSERT OR IGNORE INTO transactions (external_id, date, merchant_name, description, amount_cents, status)
     VALUES (?, ?, ?, ?, ?, 'pending')`
  );

  for (const txn of TRANSACTIONS) {
    insert.run(txn.externalId, txn.date, txn.merchantName, txn.description, txn.amountCents);
  }

  const count = sqlite
    .prepare(`SELECT COUNT(*) as count FROM transactions`)
    .get() as { count: number };
  console.log(`Transactions seeded: ${count.count} transactions total`);

  const ambiguous = sqlite
    .prepare(`SELECT COUNT(*) as count FROM transactions WHERE merchant_name IS NULL`)
    .get() as { count: number };
  console.log(`  └─ ${ambiguous.count} ambiguous (no merchant name), ${count.count - ambiguous.count} clear`);
}

const isDirectRun = process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js');
if (isDirectRun) {
  seedChartOfAccounts()
    .then(() => seedTransactions())
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}
