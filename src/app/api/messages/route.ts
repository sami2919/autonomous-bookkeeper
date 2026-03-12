import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db/index';
import { transactions } from '@/db/schema';
import { handleCustomerResponse } from '@/agents/orchestrator';
import { requireApiKey } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { getMessagesForTransaction } from '@/lib/queries';
import { classifyApiError } from '@/lib/errors';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const rateLimitError = rateLimit(request);
  if (rateLimitError) return rateLimitError;

  try {
    const { searchParams } = new URL(request.url);
    const transactionIdParam = searchParams.get('transactionId');

    if (!transactionIdParam) {
      return NextResponse.json(
        { data: null, error: 'transactionId query parameter is required' },
        { status: 400 }
      );
    }

    const transactionId = parseInt(transactionIdParam, 10);
    if (isNaN(transactionId) || transactionId <= 0) {
      return NextResponse.json(
        { data: null, error: 'transactionId must be a positive integer' },
        { status: 400 }
      );
    }

    const messages = getMessagesForTransaction(transactionId);

    return NextResponse.json({ data: messages });
  } catch (err) {
    console.error('[GET /api/messages]', err);
    return NextResponse.json(
      { data: null, error: 'Failed to fetch messages' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const rateLimitError = rateLimit(request);
  if (rateLimitError) return rateLimitError;

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { data: null, error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    if (typeof body !== 'object' || body === null) {
      return NextResponse.json(
        { data: null, error: 'Request body must be a JSON object' },
        { status: 400 }
      );
    }

    const { transactionId, content } = body as Record<string, unknown>;

    if (typeof transactionId !== 'number' || !Number.isInteger(transactionId) || transactionId <= 0) {
      return NextResponse.json(
        { data: null, error: 'transactionId must be a positive integer' },
        { status: 400 }
      );
    }

    if (typeof content !== 'string' || content.trim().length === 0) {
      return NextResponse.json(
        { data: null, error: 'content must be a non-empty string' },
        { status: 400 }
      );
    }

    if (content.trim().length > 5000) {
      return NextResponse.json(
        { data: null, error: 'content must not exceed 5000 characters' },
        { status: 400 }
      );
    }

    const result = await handleCustomerResponse(transactionId, content.trim());

    // Return the updated transaction alongside the agent result
    const [updatedTransaction] = db
      .select()
      .from(transactions)
      .where(eq(transactions.id, transactionId))
      .all();

    return NextResponse.json({
      data: {
        transaction: updatedTransaction ?? null,
        agentResult: result,
      },
    });
  } catch (err) {
    console.error('[POST /api/messages]', err);
    const classified = classifyApiError(err);
    return NextResponse.json(
      { data: null, error: classified.message },
      { status: classified.status }
    );
  }
}
