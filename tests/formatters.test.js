import { describe, it, expect } from 'vitest';
import { formatUSD, formatTokens, dayKey, weekKey } from '../src/shared/formatters.js';

describe('formatters', () => {
  it('formats USD with a sub-cent floor', () => {
    expect(formatUSD(0)).toBe('$0.00');
    expect(formatUSD(0.004)).toBe('<$0.01');
    expect(formatUSD(12.5)).toBe('$12.50');
  });

  it('formats token magnitudes', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(1500)).toBe('1.5K');
    expect(formatTokens(2_500_000)).toBe('2.50M');
  });

  it('produces stable day/week keys', () => {
    const ts = Math.floor(Date.UTC(2026, 5, 10, 12, 0, 0) / 1000); // 2026-06-10
    expect(dayKey(ts)).toMatch(/^2026-06-\d{2}$/);
    expect(weekKey(ts)).toMatch(/^2026-W\d{2}$/);
  });
});
