// Maps upstream API errors to user-friendly responses.
// Covers HTTP status codes, network errors, timeouts, malformed responses, and model refusals.

export function classifyApiError(err: unknown): { status: number; message: string } {
  // HTTP status-based errors (Anthropic APIError and similar)
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

  if (err instanceof Error) {
    const name = err.name;
    const msg = err.message.toLowerCase();

    // Abort / timeout errors
    if (name === 'AbortError' || name === 'TimeoutError' || msg.includes('abort') || msg.includes('timeout')) {
      return { status: 504, message: 'AI service request timed out — try again in a moment' };
    }

    // Network errors (ECONNRESET, ECONNREFUSED, ETIMEDOUT, ENOTFOUND, fetch failures)
    if (
      msg.includes('econnreset') ||
      msg.includes('econnrefused') ||
      msg.includes('etimedout') ||
      msg.includes('enotfound') ||
      msg.includes('fetch failed') ||
      msg.includes('network')
    ) {
      return { status: 503, message: 'Network error connecting to AI service — check your connection' };
    }

    // JSON parse errors (malformed LLM response)
    if (name === 'SyntaxError' || msg.includes('json') || msg.includes('unexpected token')) {
      return { status: 502, message: 'AI service returned a malformed response — try again' };
    }

    // Model refusal / content filter
    if (msg.includes('refusal') || msg.includes('content_filter') || msg.includes('safety')) {
      return { status: 422, message: 'AI model declined to process this request' };
    }
  }

  return { status: 500, message: 'An unexpected error occurred during processing' };
}
