import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import copilot from '../src/sources/copilot/index.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const main = path.join(dir, 'fixtures', 'cp-main.jsonl');
const modelsJson = path.join(dir, 'fixtures', 'cp-models.json');

describe('copilot.parse', () => {
  const parsed = copilot.parse(main);

  it('parses two llm_request calls (ignores tool_call)', () => {
    expect(parsed.calls.length).toBe(2);
  });

  it('derives fresh input as inputTokens - cachedTokens', () => {
    const first = parsed.calls[0];
    expect(first.inputFresh).toBe(200); // 1000 - 800
    expect(first.cacheRead).toBe(800);
    expect(first.output).toBe(50);
  });

  it('handles calls without cache fields', () => {
    const second = parsed.calls[1];
    expect(second.inputFresh).toBe(2000);
    expect(second.cacheRead).toBe(0);
  });

  it('captures title and models', () => {
    expect(parsed.title).toMatch(/docker build/);
    expect(parsed.models).toEqual(['claude-sonnet-4.6']);
  });
});

describe('copilot.loadPricing', () => {
  it('converts models.json prices to $/Mtok', () => {
    const map = copilot.loadPricing(modelsJson);
    const p = map.get('claude-sonnet-4.6');
    expect(p.input).toBe(3);
    expect(p.output).toBe(15);
    expect(p.cacheRead).toBeCloseTo(0.3, 5);
  });
});
