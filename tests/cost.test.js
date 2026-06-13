import { describe, it, expect } from 'vitest';
import { computeCallCost } from '../src/compute/cost.js';
import { getClaudePricing } from '../src/compute/pricing.js';

describe('computeCallCost (Claude, derived cache rates)', () => {
  it('applies 0.1x read and 1.25x write multipliers (5m)', () => {
    const call = { inputFresh: 10, cacheRead: 100, cacheWrite: 50, output: 20 };
    const pricing = { input: 5, output: 25 };
    // 10*5 + 100*0.5 + 50*6.25 + 20*25 = 50 + 50 + 312.5 + 500 = 912.5 per Mtok
    const cost = computeCallCost(call, pricing, { cacheWriteTtl: '5m' });
    expect(cost).toBeCloseTo(912.5 / 1e6, 10);
  });

  it('uses 2x write multiplier for 1h ttl', () => {
    const call = { inputFresh: 0, cacheRead: 0, cacheWrite: 100, output: 0 };
    const cost = computeCallCost(call, { input: 5, output: 25 }, { cacheWriteTtl: '1h' });
    expect(cost).toBeCloseTo((100 * 10) / 1e6, 10); // 5 * 2 = 10 per tok
  });

  it('returns 0 for unknown pricing', () => {
    expect(computeCallCost({ inputFresh: 100 }, null)).toBe(0);
  });
});

describe('computeCallCost (Copilot, explicit cache rate)', () => {
  it('uses provided cacheRead rate instead of deriving it', () => {
    const call = { inputFresh: 200, cacheRead: 800, cacheWrite: 0, output: 50 };
    const pricing = { input: 3, output: 15, cacheRead: 0.3 };
    // 200*3 + 800*0.3 + 50*15 = 600 + 240 + 750 = 1590
    expect(computeCallCost(call, pricing)).toBeCloseTo(1590 / 1e6, 10);
  });
});

describe('getClaudePricing', () => {
  it('matches families by substring', () => {
    expect(getClaudePricing('claude-opus-4-8')).toMatchObject({ input: 5, output: 25 });
    expect(getClaudePricing('claude-haiku-4-5-20251001')).toMatchObject({ input: 1, output: 5 });
    expect(getClaudePricing('claude-sonnet-4-6')).toMatchObject({ input: 3, output: 15 });
    expect(getClaudePricing('claude-fable-5')).toMatchObject({ input: 10, output: 50 });
  });
  it('returns null for unknown models', () => {
    expect(getClaudePricing('gpt-4o')).toBeNull();
    expect(getClaudePricing('')).toBeNull();
  });
});
