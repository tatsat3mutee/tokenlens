import { describe, it, expect } from 'vitest';
import { analyzeCacheBreaks } from '../src/db/sync.js';

describe('analyzeCacheBreaks', () => {
  it('counts fresh input tokens re-sent on cache-break calls by cause', () => {
    const result = analyzeCacheBreaks([
      { model: 'sonnet', inputFresh: 200, cacheRead: 4000 },
      { model: 'sonnet', inputFresh: 6000, cacheRead: 0, systemPromptFile: 's1', toolsFile: 't1' },
      { model: 'sonnet', inputFresh: 100, cacheRead: 5000, systemPromptFile: 's1', toolsFile: 't1' },
      { model: 'opus', inputFresh: 7000, cacheRead: 0, systemPromptFile: 's1', toolsFile: 't1' },
      { model: 'opus', inputFresh: 100, cacheRead: 5000, systemPromptFile: 's1', toolsFile: 't1' },
      { model: 'opus', inputFresh: 8000, cacheRead: 0, systemPromptFile: 's2', toolsFile: 't1' },
      { model: 'opus', inputFresh: 100, cacheRead: 5000, systemPromptFile: 's2', toolsFile: 't1' },
      { model: 'opus', inputFresh: 9000, cacheRead: 0, systemPromptFile: 's2', toolsFile: 't2' },
    ]);

    expect(result.total).toBe(4);
    expect(result.tokens).toBe(30000);
    expect(result.causes).toEqual({ model_switch: 1, system_prompt_change: 1, tools_changed: 1, eviction: 1 });
    expect(result.tokenCauses).toEqual({ model_switch: 7000, system_prompt_change: 8000, tools_changed: 9000, eviction: 6000 });
  });

  it('does not count repeated cold calls after a cache break', () => {
    const result = analyzeCacheBreaks([
      { model: 'sonnet', inputFresh: 200, cacheRead: 4000 },
      { model: 'sonnet', inputFresh: 6000, cacheRead: 0 },
      { model: 'sonnet', inputFresh: 7000, cacheRead: 0 },
    ]);

    expect(result.total).toBe(1);
    expect(result.tokens).toBe(6000);
  });
});