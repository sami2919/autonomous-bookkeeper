import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/db/index';
import { transactions } from '@/db/schema';
import { seedChartOfAccounts, seedTransactions } from '@/db/seed';
import { requireApiKey } from '@/lib/auth';
import { getTransactionsWithAccounts } from '@/lib/queries';

const VALID_STATUSES = new Set(['pending', 'categorized', 'needs_clarification', 'posted']);

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = requireApiKey(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get('status');

    if (statusParam !== null && !VALID_STATUSES.has(statusParam)) {
      return NextResponse.json(
        {
          data: null,
          error: `Invalid status. Must be one of: ${[...VALID_STATUSES].join(', ')}`,
        },
        { status: 400 }
      );
    }

    const rows = getTransactionsWithAccounts(
      statusParam as 'pending' | 'categorized' | 'needs_clarification' | 'posted' | undefined
    );

    return NextResponse.json({ data: rows });
  } catch (err) {
    console.error('[GET /api/transactions]', err);
    return NextResponse.json(
      { data: null, error: 'Failed to fetch transactions' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authError = requireApiKey(request);
  if (authError) return authError;

  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { data: null, error: 'Seeding is disabled in production' },
      { status: 403 }
    );
  }

  try {
    await seedChartOfAccounts();
    await seedTransactions();

    const [row] = db
      .select({ count: sql<number>`count(*)` })
      .from(transactions)
      .all();

    return NextResponse.json({
      data: { seeded: true, totalTransactions: row?.count ?? 0 },
    });
  } catch (err) {
    console.error('[POST /api/transactions]', err);
    return NextResponse.json(
      { data: null, error: 'Failed to seed transactions' },
      { status: 500 }
    );
  }
}
