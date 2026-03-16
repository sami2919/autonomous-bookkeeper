import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/auth';
import { getLedgerEntries } from '@/lib/queries';
import { classifyApiError } from '@/lib/errors';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = requireApiKey(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const transactionIdParam = searchParams.get('transactionId');

    let transactionId: number | undefined;
    if (transactionIdParam !== null) {
      const parsed = parseInt(transactionIdParam, 10);
      if (isNaN(parsed) || parsed <= 0) {
        return NextResponse.json(
          { data: null, error: 'transactionId must be a positive integer' },
          { status: 400 }
        );
      }
      transactionId = parsed;
    }

    const data = getLedgerEntries(transactionId);

    return NextResponse.json({ data });
  } catch (err) {
    console.error('[GET /api/ledger]', err);
    const classified = classifyApiError(err);
    return NextResponse.json(
      { data: null, error: classified.message },
      { status: classified.status }
    );
  }
}
