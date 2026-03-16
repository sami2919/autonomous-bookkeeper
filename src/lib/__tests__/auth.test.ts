import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/auth';

function makeRequest(headers: Record<string, string>): NextRequest {
  const url = 'http://localhost:3000/api/test';
  const req = new NextRequest(url, { headers });
  return req;
}

describe('requireApiKey', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Isolate env mutations per test
    vi.stubEnv('API_KEY', 'test-secret-key');
    vi.stubEnv('NODE_ENV', 'development');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('same-origin requests (bypass API key check)', () => {
    it('allows request when Origin header matches host', () => {
      const req = makeRequest({
        host: 'localhost:3000',
        origin: 'http://localhost:3000',
      });
      expect(requireApiKey(req)).toBeNull();
    });

    it('allows request when Referer header matches host', () => {
      const req = makeRequest({
        host: 'localhost:3000',
        referer: 'http://localhost:3000/dashboard',
      });
      expect(requireApiKey(req)).toBeNull();
    });

    it('prefers Origin over Referer when both present', () => {
      // Origin matches, referer does not -- should still pass
      const req = makeRequest({
        host: 'localhost:3000',
        origin: 'http://localhost:3000',
        referer: 'http://evil.com/page',
      });
      expect(requireApiKey(req)).toBeNull();
    });
  });

  describe('API key validation (non-same-origin)', () => {
    it('allows request with correct API key', () => {
      const req = makeRequest({
        'x-api-key': 'test-secret-key',
      });
      expect(requireApiKey(req)).toBeNull();
    });

    it('rejects request with wrong API key', () => {
      const req = makeRequest({
        'x-api-key': 'wrong-key',
      });
      const res = requireApiKey(req);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(401);
    });

    it('rejects request with no API key header when API_KEY is set', () => {
      const req = makeRequest({});
      const res = requireApiKey(req);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(401);
    });
  });

  describe('missing API_KEY env var', () => {
    it('allows request in non-production when API_KEY is not set', () => {
      vi.stubEnv('API_KEY', '');
      // requireApiKey reads process.env.API_KEY; empty string is falsy
      // We need to actually delete it to simulate "not set"
      delete process.env.API_KEY;
      vi.stubEnv('NODE_ENV', 'development');

      const req = makeRequest({});
      expect(requireApiKey(req)).toBeNull();
    });

    it('rejects request in production when API_KEY is not set', () => {
      delete process.env.API_KEY;
      vi.stubEnv('NODE_ENV', 'production');

      const req = makeRequest({});
      const res = requireApiKey(req);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(401);
    });
  });

  describe('isSameOriginRequest edge cases (tested indirectly)', () => {
    it('rejects when origin URL is invalid', () => {
      const req = makeRequest({
        host: 'localhost:3000',
        origin: 'not-a-valid-url',
      });
      // Invalid origin means not same-origin, falls through to API key check
      // With correct API key it should pass
      const reqWithKey = makeRequest({
        host: 'localhost:3000',
        origin: 'not-a-valid-url',
        'x-api-key': 'test-secret-key',
      });
      expect(requireApiKey(reqWithKey)).toBeNull();

      // Without correct API key it should reject
      const reqWithoutKey = makeRequest({
        host: 'localhost:3000',
        origin: 'not-a-valid-url',
        'x-api-key': 'wrong',
      });
      const res = requireApiKey(reqWithoutKey);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(401);
    });

    it('rejects when host header is missing', () => {
      // NextRequest always sets host from the URL, but we test the logic:
      // no origin/referer and no host means not same-origin
      const req = makeRequest({
        'x-api-key': 'wrong-key',
      });
      const res = requireApiKey(req);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(401);
    });

    it('rejects cross-origin request (origin host differs from host)', () => {
      const req = makeRequest({
        host: 'localhost:3000',
        origin: 'http://evil.com',
        'x-api-key': 'wrong-key',
      });
      const res = requireApiKey(req);
      expect(res).not.toBeNull();
      expect(res!.status).toBe(401);
    });
  });
});
