import { describe, it, expect } from 'vitest';
import { dollarsToCents } from '@/tools/ledger';

describe('dollarsToCents', () => {
  // ─── Normal values ───────────────────────────────────────────────────────────

  it('converts $1.00 to 100 cents', () => {
    expect(dollarsToCents(1.0)).toBe(100);
  });

  it('converts $0.01 to 1 cent', () => {
    expect(dollarsToCents(0.01)).toBe(1);
  });

  it('converts $99.99 to 9999 cents', () => {
    expect(dollarsToCents(99.99)).toBe(9999);
  });

  it('converts $0.00 to 0 cents', () => {
    expect(dollarsToCents(0)).toBe(0);
  });

  // ─── IEEE 754 edge cases ─────────────────────────────────────────────────────

  it('handles 0.1 + 0.2 correctly (IEEE 754 drift)', () => {
    // 0.1 + 0.2 === 0.30000000000000004 in JS
    expect(dollarsToCents(0.1 + 0.2)).toBe(30);
  });

  // ─── Rounding with epsilon ───────────────────────────────────────────────────

  it('rounds 1.005 to 101 cents (epsilon corrects half-cent)', () => {
    // 1.005 * 100 === 100.49999999999999 without epsilon
    expect(dollarsToCents(1.005)).toBe(101);
  });

  // ─── Negative values (valid for credits) ─────────────────────────────────────

  it('converts -$5.50 to -550 cents', () => {
    expect(dollarsToCents(-5.5)).toBe(-550);
  });

  it('converts -$0.01 to -1 cent', () => {
    expect(dollarsToCents(-0.01)).toBe(-1);
  });

  // ─── Guard against Infinity and NaN ──────────────────────────────────────────

  it('throws for Infinity', () => {
    expect(() => dollarsToCents(Infinity)).toThrow(/finite number/i);
  });

  it('throws for -Infinity', () => {
    expect(() => dollarsToCents(-Infinity)).toThrow(/finite number/i);
  });

  it('throws for NaN', () => {
    expect(() => dollarsToCents(NaN)).toThrow(/finite number/i);
  });
});
