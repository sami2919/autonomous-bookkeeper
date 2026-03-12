import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/index';
import { getTrialBalance, getIncomeStatement, getBalanceSheet } from '@/agents/reporting';
import { requireApiKey } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';

const VALID_REPORT_TYPES = ['trial-balance', 'income-statement', 'balance-sheet'] as const;
type ReportType = (typeof VALID_REPORT_TYPES)[number];

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const d = new Date(value);
  return !isNaN(d.getTime());
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = requireApiKey(request);
  if (authError) return authError;

  const rateLimitError = rateLimit(request);
  if (rateLimitError) return rateLimitError;

  try {
    const { searchParams } = new URL(request.url);
    const typeParam = searchParams.get('type');

    if (!typeParam) {
      return NextResponse.json(
        {
          data: null,
          error: `type query parameter is required. Must be one of: ${VALID_REPORT_TYPES.join(', ')}`,
        },
        { status: 400 }
      );
    }

    if (!VALID_REPORT_TYPES.includes(typeParam as ReportType)) {
      return NextResponse.json(
        {
          data: null,
          error: `Invalid report type "${typeParam}". Must be one of: ${VALID_REPORT_TYPES.join(', ')}`,
        },
        { status: 400 }
      );
    }

    const reportType = typeParam as ReportType;

    if (reportType === 'trial-balance') {
      const report = getTrialBalance(db);
      return NextResponse.json({ data: report });
    }

    if (reportType === 'income-statement') {
      const startDate = searchParams.get('startDate');
      const endDate = searchParams.get('endDate');

      if (!startDate || !endDate) {
        return NextResponse.json(
          { data: null, error: 'startDate and endDate are required for income-statement (YYYY-MM-DD)' },
          { status: 400 }
        );
      }

      if (!isValidDate(startDate) || !isValidDate(endDate)) {
        return NextResponse.json(
          { data: null, error: 'startDate and endDate must be valid ISO 8601 dates (YYYY-MM-DD)' },
          { status: 400 }
        );
      }

      if (startDate > endDate) {
        return NextResponse.json(
          { data: null, error: 'startDate must not be after endDate' },
          { status: 400 }
        );
      }

      const report = getIncomeStatement(db, startDate, endDate);
      return NextResponse.json({ data: report });
    }

    // balance-sheet
    const asOfDate = searchParams.get('asOfDate') ?? new Date().toISOString().slice(0, 10);

    if (!isValidDate(asOfDate)) {
      return NextResponse.json(
        { data: null, error: 'asOfDate must be a valid ISO 8601 date (YYYY-MM-DD)' },
        { status: 400 }
      );
    }

    const report = getBalanceSheet(db, asOfDate);
    return NextResponse.json({ data: report });
  } catch (err) {
    console.error('[GET /api/reports]', err);
    return NextResponse.json({ data: null, error: 'Failed to generate report' }, { status: 500 });
  }
}
