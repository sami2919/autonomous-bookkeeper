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
});
