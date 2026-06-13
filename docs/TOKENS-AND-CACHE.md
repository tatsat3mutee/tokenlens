# Tokens & cache deep dive

Tokens are the exact, source-of-truth signal in this extension. This page explains the token types, how prompt caching shows up, what a "cache break" is, and how all of it relates to VS Code's built-in **Agent Debug / Cache Explorer**.

## Token types

Every LLM call is normalized to four token counts:

| Type | Claude Code field | Copilot derivation | Gemini CLI derivation | Meaning |
|---|---|---|---|---|
| **Fresh input** | `usage.input_tokens` | `inputTokens − cachedTokens` | `max(0, tokens.input − tokens.cached) + tokens.tool` | New prompt tokens processed at full price. |
| **Cached read** | `usage.cache_read_input_tokens` | `cachedTokens` | `tokens.cached` | Prompt prefix served from cache (~0.1× input cost; ~0.25× for Gemini). |
| **Cache write** | `usage.cache_creation_input_tokens` | (not exposed) | always 0 (implicit caching, no write fee) | Tokens written into the cache (1.25×/2× input). |
| **Output** | `usage.output_tokens` | `outputTokens` | `tokens.output + tokens.thoughts` | Generated tokens (Gemini "thoughts" are thinking tokens, billed as output). |

> Important difference: Anthropic's `input_tokens` **excludes** cached reads, while Copilot's `inputTokens` and Gemini CLI's `tokens.input` **include** them — so for those sources we subtract cached tokens to get fresh input. This is handled in each source parser.

## Cache hit & efficiency

```
cache hit / efficiency = cached_read / (fresh_input + cached_read)
```

Shown per session, per model, and overall, color-coded: **green ≥70%**, **amber 40–69%**, **red <40%**. High cache hit means the agent is reusing a stable prompt prefix; low or collapsing hit means the cache keeps getting invalidated.

## Cache breaks

A **cache break** is a call where a warm cache *was* available (the previous call read from cache) but this call read essentially nothing from it — the prefix was invalidated and re-sent at full price. We count one per such transition (on non-trivial requests, ≥2000 prompt tokens, cache-read ratio <5%).

Why caches break (prefix-cache rules: any byte change in the prefix invalidates everything after it):

| Cause | Signal in the logs |
|---|---|
| Model switch | `model` changed between consecutive calls |
| System prompt rebuilt | Copilot `systemPromptFile` changed (e.g. `system_prompt_0.json` → `system_prompt_1.json`) |
| Tools changed | Copilot `toolsFile` changed (`tools_0.json` → `tools_1.json`) |
| Compaction / eviction | History trimmed to fit context, or provider cache TTL expired (no other identifiable cause) |

The dashboard surfaces a **cache-breaks count** per session and in the deep-dive panel, **classified by cause** (`model switch` / `sys-prompt change` / `tools changed` / `eviction`). It also shows **cache-break token impact**: the fresh input tokens on break calls, which approximates how many prompt tokens were re-sent at full price because the warm prefix was lost. Classification uses the model id plus Copilot's `systemPromptFile`/`toolsFile` sidecar references between consecutive calls. Claude Code sessions typically show few breaks (its prefix stays stable); Copilot shows more because it rebuilds prompts/tools more often.

> **Gemini CLI caveat:** Gemini uses *implicit* caching managed server-side — there are no explicit cache writes or TTLs to lose, so "cache break" semantics are weaker for this source. A drop to 0 cached tokens usually just means the implicit cache didn't match, not that a paid warm cache was evicted (and there's no cache-write fee to waste). Treat Gemini cache-break counts as informational only.

## Relationship to VS Code's Agent Debug / Cache Explorer

VS Code ships a built-in **Cache Explorer** under *Agent Debug Logs* for GitHub Copilot. It does **structural prefix diffing** — it compares the actual prompt content of consecutive requests, character by character, to show exactly which bytes changed and broke the cache. It reads the same per-session artifacts this extension does:

```
GitHub.copilot-chat/debug-logs/<session>/
├── main.jsonl            ← per-call events (token counts, systemPromptFile, toolsFile, requestShape)
├── models.json           ← model metadata
├── system_prompt_0.json  ← system-prompt snapshots (sidecar; referenced by systemPromptFile)
├── system_prompt_1.json
├── tools_0.json          ← tool-catalog snapshots (referenced by toolsFile)
├── tools_1.json
└── runSubagent-*.jsonl    ← sub-agent call streams
```

**How this extension differs and complements it:**

- **Cache Explorer:** precise, structural, but only for the current/recent Copilot sessions and Copilot only.
- **TokenLens:** token-count + file-reference heuristics (less byte-precise), but adds **historical persistence** (survives log cleanup, stored in SQLite), **cross-session aggregates** (cache-break counts and token impact over a time window), and **cross-tool coverage** (Claude Code, Copilot, *and* Gemini CLI in one view).

Use Cache Explorer to debug *why a specific request* broke the cache; use TokenLens to see *patterns and totals* over time and across all your AI tools.

### Roadmap

Cause classification (model switch / system-prompt change / tools change / eviction) is implemented as of 0.5.0. Token impact per cause is implemented as of 0.6.0. A future version could add byte-level structural prefix diffing (like Cache Explorer) by reading the `system_prompt_*.json` / `tools_*.json` sidecar contents.
