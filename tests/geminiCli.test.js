import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import geminiCli from '../src/sources/geminiCli/index.js';
import { getGeminiPricing } from '../src/compute/pricing.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const jsonlMain = path.join(dir, 'fixtures', 'gm-session.jsonl');
const legacyJson = path.join(dir, 'fixtures', 'gm-legacy.json');

describe('geminiCli.parse (jsonl)', () => {
  const parsed = geminiCli.parse(jsonlMain, [legacyJson]);

  it('only counts gemini messages that carry tokens', () => {
    // 2 from main jsonl + 1 from the legacy sub file; m6 has no tokens.
    expect(parsed.calls.length).toBe(3);
  });

  it('computes fresh input = input - cached + tool, output includes thoughts', () => {
    const pro = parsed.calls.find((c) => c.model === 'gemini-2.5-pro');
    expect(pro.inputFresh).toBe(1000 - 600 + 30);
    expect(pro.cacheRead).toBe(600);
    expect(pro.cacheWrite).toBe(0); // implicit caching: never a write fee
    expect(pro.output).toBe(200 + 50);
  });

  it('handles zero-cache calls', () => {
    const flash = parsed.calls.find((c) => c.model === 'gemini-2.5-flash');
    expect(flash.inputFresh).toBe(500);
    expect(flash.cacheRead).toBe(0);
    expect(flash.output).toBe(100);
  });

  it('flags calls from subagent files', () => {
    const subCall = parsed.calls.find((c) => c.model === 'gemini-2.5-flash-lite');
    expect(subCall.isSubagent).toBe(true);
    const mainCall = parsed.calls.find((c) => c.model === 'gemini-2.5-pro');
    expect(mainCall.isSubagent).toBe(false);
  });

  it('takes the title from the first user message in the main file', () => {
    expect(parsed.title).toMatch(/parser for session files/);
  });

  it('collects all models', () => {
    expect(parsed.models.sort()).toEqual(['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro']);
  });

  it('tracks time bounds (metadata + messages)', () => {
    expect(parsed.firstTs).toBeLessThan(parsed.lastTs);
    // The legacy sub file's earliest message (Jan 9) beats the main metadata startTime (Jan 10).
    expect(parsed.firstTs).toBe(Math.floor(Date.parse('2026-01-09T08:00:02.000Z') / 1000));
  });
});

describe('geminiCli.parse (legacy json)', () => {
  const parsed = geminiCli.parse(legacyJson, []);

  it('parses the messages array', () => {
    expect(parsed.calls.length).toBe(1);
    expect(parsed.calls[0].inputFresh).toBe(200);
    expect(parsed.calls[0].cacheRead).toBe(100);
  });

  it('skips injected session_context when picking a title', () => {
    expect(parsed.title).toBe('summarize this repo');
  });
});

describe('getGeminiPricing', () => {
  it('matches model families', () => {
    expect(getGeminiPricing('gemini-2.5-pro').family).toBe('2.5-pro');
    expect(getGeminiPricing('gemini-2.0-flash-001').family).toBe('2.0-flash');
    expect(getGeminiPricing('gemini-1.5-pro-latest').family).toBe('1.5-pro');
  });

  it('does not let 2.5-flash shadow 2.5-flash-lite', () => {
    expect(getGeminiPricing('gemini-2.5-flash-lite').family).toBe('2.5-flash-lite');
    expect(getGeminiPricing('gemini-2.5-flash').family).toBe('2.5-flash');
  });

  it('returns null for unknown models', () => {
    expect(getGeminiPricing('gemini-9.9-ultra')).toBeNull();
    expect(getGeminiPricing('')).toBeNull();
  });

  it('charges no cache-write fee (implicit caching)', () => {
    expect(getGeminiPricing('gemini-2.5-pro').cacheWrite).toBe(0);
  });
});
