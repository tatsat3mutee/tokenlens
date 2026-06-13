import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import claudeCode from '../src/sources/claudeCode/index.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const main = path.join(dir, 'fixtures', 'cc-session.jsonl');
const sub = path.join(dir, 'fixtures', 'cc-sub.jsonl');

describe('claudeCode.parse', () => {
  const parsed = claudeCode.parse(main, [sub]);

  it('dedupes assistant messages by id', () => {
    // msg_1 appears twice; should count once. So opus(1) + haiku(1) + subagent(1) = 3.
    expect(parsed.calls.length).toBe(3);
  });

  it('extracts token splits (fresh input excludes cache)', () => {
    const opus = parsed.calls.find((c) => c.model === 'claude-opus-4-8');
    expect(opus.inputFresh).toBe(10);
    expect(opus.cacheRead).toBe(100);
    expect(opus.cacheWrite).toBe(50);
    expect(opus.output).toBe(20);
  });

  it('flags sub-agent calls', () => {
    const subCall = parsed.calls.find((c) => c.cacheWrite === 11421);
    expect(subCall).toBeTruthy();
    expect(subCall.isSubagent).toBe(true);
  });

  it('captures title, workspace, and models', () => {
    expect(parsed.title).toMatch(/refactor the auth module/);
    expect(parsed.workspace).toMatch(/demo/);
    expect(parsed.models.sort()).toEqual(['claude-haiku-4-5-20251001', 'claude-opus-4-8']);
  });

  it('tracks time bounds', () => {
    expect(parsed.firstTs).toBeLessThan(parsed.lastTs);
  });
});
