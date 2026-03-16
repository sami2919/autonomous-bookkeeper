import { describe, it, expect } from 'vitest';
import { classifyApiError } from '@/lib/errors';

describe('classifyApiError', () => {
  it('classifies 401 as invalid API key', () => {
    const result = classifyApiError({ status: 401, message: 'Unauthorized' });
    expect(result.status).toBe(401);
    expect(result.message).toMatch(/API key/i);
  });

  it('classifies 429 as rate limited', () => {
    const result = classifyApiError({ status: 429, message: 'Too Many Requests' });
    expect(result.status).toBe(429);
    expect(result.message).toMatch(/rate limited/i);
  });

  it('classifies 529 as overloaded (mapped to 503)', () => {
    const result = classifyApiError({ status: 529, message: 'Overloaded' });
    expect(result.status).toBe(503);
    expect(result.message).toMatch(/overloaded/i);
  });

  it('classifies other status codes as generic API error (502)', () => {
    const result = classifyApiError({ status: 500, message: 'Internal Server Error' });
    expect(result.status).toBe(502);
    expect(result.message).toContain('500');
  });

  it('classifies unknown error objects without status as 500', () => {
    const result = classifyApiError(new Error('something broke'));
    expect(result.status).toBe(500);
    expect(result.message).toMatch(/unexpected error/i);
  });

  it('classifies null as 500', () => {
    const result = classifyApiError(null);
    expect(result.status).toBe(500);
    expect(result.message).toMatch(/unexpected error/i);
  });

  it('classifies undefined as 500', () => {
    const result = classifyApiError(undefined);
    expect(result.status).toBe(500);
    expect(result.message).toMatch(/unexpected error/i);
  });

  it('classifies a string as 500', () => {
    const result = classifyApiError('some string error');
    expect(result.status).toBe(500);
    expect(result.message).toMatch(/unexpected error/i);
  });

  // Timeout errors → 504
  describe('timeout errors', () => {
    it('classifies AbortError as 504', () => {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      const result = classifyApiError(err);
      expect(result.status).toBe(504);
      expect(result.message).toMatch(/timed out/i);
    });

    it('classifies TimeoutError as 504', () => {
      const err = new Error('Request timed out');
      err.name = 'TimeoutError';
      const result = classifyApiError(err);
      expect(result.status).toBe(504);
      expect(result.message).toMatch(/timed out/i);
    });

    it('classifies error message containing "timeout" as 504', () => {
      const result = classifyApiError(new Error('Connection timeout after 30s'));
      expect(result.status).toBe(504);
      expect(result.message).toMatch(/timed out/i);
    });
  });

  // Network errors → 503
  describe('network errors', () => {
    it('classifies ECONNRESET as 503', () => {
      const result = classifyApiError(new Error('read ECONNRESET'));
      expect(result.status).toBe(503);
      expect(result.message).toMatch(/network error/i);
    });

    it('classifies ECONNREFUSED as 503', () => {
      const result = classifyApiError(new Error('connect ECONNREFUSED 127.0.0.1:443'));
      expect(result.status).toBe(503);
      expect(result.message).toMatch(/network error/i);
    });

    it('classifies ETIMEDOUT as 503', () => {
      const result = classifyApiError(new Error('connect ETIMEDOUT 1.2.3.4:443'));
      expect(result.status).toBe(503);
      expect(result.message).toMatch(/network error/i);
    });

    it('classifies "fetch failed" as 503', () => {
      const result = classifyApiError(new Error('fetch failed'));
      expect(result.status).toBe(503);
      expect(result.message).toMatch(/network error/i);
    });
  });

  // Malformed response errors → 502
  describe('malformed response errors', () => {
    it('classifies SyntaxError as 502', () => {
      const err = new SyntaxError('Unexpected token < in JSON at position 0');
      const result = classifyApiError(err);
      expect(result.status).toBe(502);
      expect(result.message).toMatch(/malformed response/i);
    });

    it('classifies error message containing "json" as 502', () => {
      const result = classifyApiError(new Error('Invalid JSON in response body'));
      expect(result.status).toBe(502);
      expect(result.message).toMatch(/malformed response/i);
    });
  });

  // Model refusal errors → 422
  describe('model refusal errors', () => {
    it('classifies error message containing "refusal" as 422', () => {
      const result = classifyApiError(new Error('Model returned a refusal'));
      expect(result.status).toBe(422);
      expect(result.message).toMatch(/declined/i);
    });

    it('classifies error message containing "content_filter" as 422', () => {
      const result = classifyApiError(new Error('Blocked by content_filter'));
      expect(result.status).toBe(422);
      expect(result.message).toMatch(/declined/i);
    });
  });
});
