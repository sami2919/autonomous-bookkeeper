import { NextRequest, NextResponse } from 'next/server';
import { processAllTransactions } from '@/agents/orchestrator';
import { requireApiKey } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { classifyApiError } from '@/lib/errors';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const rateLimitError = rateLimit(request);
  if (rateLimitError) return rateLimitError;

  try {
    const summary = await processAllTransactions();
    return NextResponse.json({ data: summary });
  } catch (err) {
    console.error('[POST /api/transactions/process]', err);
    const classified = classifyApiError(err);
    return NextResponse.json(
      { data: null, error: classified.message },
      { status: classified.status }
    );
  }
}
