import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

function makeRequest(ip?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (ip) {
    headers['x-forwarded-for'] = ip;
  }
  return new NextRequest('http://localhost:3000/api/test', { headers });
}

// The rate limiter uses module-level state (Map + callCount).
// We use vi.resetModules() + dynamic import to get a fresh module for each test group.
// Combined with fake timers for time-dependent tests.

describe('rateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function freshRateLimit() {
    const mod = await import('@/lib/rate-limit');
    return mod.rateLimit;
  }

  it('allows the first request', async () => {
    const rateLimit = await freshRateLimit();
    const result = rateLimit(makeRequest('1.2.3.4'));
    expect(result).toBeNull();
  });

  it('allows 5 requests from the same IP', async () => {
    const rateLimit = await freshRateLimit();
    for (let i = 0; i < 5; i++) {
      expect(rateLimit(makeRequest('1.2.3.4'))).toBeNull();
    }
  });

  it('rejects the 6th request from the same IP with 429 and Retry-After', async () => {
    const rateLimit = await freshRateLimit();
    for (let i = 0; i < 5; i++) {
      rateLimit(makeRequest('1.2.3.4'));
    }
    const res = rateLimit(makeRequest('1.2.3.4'));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
    expect(res!.headers.get('Retry-After')).toBe('60');
  });

  it('tracks different IPs independently', async () => {
    const rateLimit = await freshRateLimit();
    // Exhaust limit for IP A
    for (let i = 0; i < 5; i++) {
      rateLimit(makeRequest('1.1.1.1'));
    }
    expect(rateLimit(makeRequest('1.1.1.1'))?.status).toBe(429);

    // IP B should still be allowed
    expect(rateLimit(makeRequest('2.2.2.2'))).toBeNull();
  });

  it('allows requests again after the window expires', async () => {
    const rateLimit = await freshRateLimit();
    // Exhaust limit
    for (let i = 0; i < 5; i++) {
      rateLimit(makeRequest('1.2.3.4'));
    }
    expect(rateLimit(makeRequest('1.2.3.4'))?.status).toBe(429);

    // Advance time past the 60s window
    vi.advanceTimersByTime(60_001);

    // Should be allowed again
    expect(rateLimit(makeRequest('1.2.3.4'))).toBeNull();
  });

  it('uses the first IP from x-forwarded-for with multiple IPs', async () => {
    const rateLimit = await freshRateLimit();
    // Send requests with multi-IP forwarded header
    for (let i = 0; i < 5; i++) {
      const req = new NextRequest('http://localhost:3000/api/test', {
        headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2, 10.0.0.3' },
      });
      rateLimit(req);
    }

    // 6th request from same first-IP should be rejected
    const req = new NextRequest('http://localhost:3000/api/test', {
      headers: { 'x-forwarded-for': '10.0.0.1, 99.99.99.99' },
    });
    expect(rateLimit(req)?.status).toBe(429);

    // But different first-IP should still be allowed
    const req2 = new NextRequest('http://localhost:3000/api/test', {
      headers: { 'x-forwarded-for': '10.0.0.2, 10.0.0.1' },
    });
    expect(rateLimit(req2)).toBeNull();
  });

  it('uses "unknown" as IP when x-forwarded-for is absent', async () => {
    const rateLimit = await freshRateLimit();
    // 5 requests with no x-forwarded-for all share "unknown" IP
    for (let i = 0; i < 5; i++) {
      rateLimit(makeRequest());
    }
    expect(rateLimit(makeRequest())?.status).toBe(429);
  });
});
