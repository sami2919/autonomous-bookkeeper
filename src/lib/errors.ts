// Maps upstream API errors to user-friendly responses.

export function classifyApiError(err: unknown): { status: number; message: string } {
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status: number }).status;
    switch (status) {
      case 401:
        return { status: 401, message: 'Invalid Anthropic API key — check your .env.local file' };
      case 429:
        return { status: 429, message: 'Anthropic API rate limited — try again in 60 seconds' };
      case 529:
        return { status: 503, message: 'Anthropic API is overloaded — try again shortly' };
      default:
        return { status: 502, message: `Anthropic API error (${status})` };
    }
  }
  return { status: 500, message: 'An unexpected error occurred during processing' };
}
