import { describe, it, expect } from 'vitest';
import { dollarsToCents } from '@/tools/ledger';

describe('dollarsToCents', () => {
  describe('standard conversions', () => {
    it('converts 1.00 to 100', () => {
      expect(dollarsToCents(1.0)).toBe(100);
    });

    it('converts 0.01 to 1', () => {
      expect(dollarsToCents(0.01)).toBe(1);
    });

    it('converts 99.99 to 9999', () => {
      expect(dollarsToCents(99.99)).toBe(9999);
    });
  });

  describe('IEEE 754 edge cases', () => {
    it('handles 0.1 + 0.2 correctly', () => {
      // 0.1 + 0.2 === 0.30000000000000004 in JS
      expect(dollarsToCents(0.1 + 0.2)).toBe(30);
    });

    it('rounds 1.005 to 101 (banker penny case)', () => {
      // 1.005 * 100 = 100.49999999999999 without epsilon correction
      expect(dollarsToCents(1.005)).toBe(101);
    });
  });

  describe('non-finite values throw', () => {
    it('throws for Infinity', () => {
      expect(() => dollarsToCents(Infinity)).toThrow(
        'Dollar amount must be a finite number'
      );
    });

    it('throws for -Infinity', () => {
      expect(() => dollarsToCents(-Infinity)).toThrow(
        'Dollar amount must be a finite number'
      );
    });

    it('throws for NaN', () => {
      expect(() => dollarsToCents(NaN)).toThrow(
        'Dollar amount must be a finite number'
      );
    });
  });

  describe('negative amounts', () => {
    it('converts -50.25 to -5025', () => {
      expect(dollarsToCents(-50.25)).toBe(-5025);
    });
  });

  describe('zero', () => {
    it('converts 0 to 0', () => {
      expect(dollarsToCents(0)).toBe(0);
    });
  });

  describe('large values', () => {
    it('converts 999999.99 to 99999999', () => {
      expect(dollarsToCents(999999.99)).toBe(99999999);
    });
  });
});
