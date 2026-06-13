# Cost methodology

AI coding tools don't bill the same way, so a single "cost" number is misleading unless you know where it comes from. This extension is **token-first**: tokens and cache stats are always exact, and a dollar figure is shown only at the confidence level it deserves.

## Confidence levels

Every session is tagged with a `cost_confidence`, and the dashboard renders cost accordingly:

| Level | Shown as | Meaning |
|---|---|---|
| `billed` | `$X.XX` | Real metered cost. Copilot calls that carry `copilotUsageNanoAiu` (premium-request credits). |
| `partial` | `$X.XX ≥` | A **lower bound** — some calls in the session predate the credit field, so the true cost is at least this. |
| `estimate` | `≈$X.XX est` | A modeled **API-equivalent** figure (Claude Code, Gemini CLI). You actually pay a flat subscription (or nothing on Gemini's free tier); this is "what the same tokens would cost on the API." Hide it with `tokenLens.showEstimatedCost: false`. |
| `none` | `—` | No trustworthy cost. Tokens are shown instead. |

> Wrong cost is worse than no cost. We deliberately show `—` rather than a fabricated number.

## How each source is priced

### GitHub Copilot — AI credits
Copilot meters usage in **premium-request credits**, surfaced per call as `copilotUsageNanoAiu` (nano-AI-units). At $0.01 per credit:

```
credits = copilotUsageNanoAiu / 1e9
USD     = copilotUsageNanoAiu / 1e11
```

Calls that carry this field → `billed`. Sessions where only some calls carry it → `partial`. Sessions with none → `none` (we do **not** fall back to the token prices in `models.json`, which are nominal and undercount badly — an earlier version did, and it reported ~37× too low).

### Claude Code — API-equivalent estimate
Claude Code has no per-token bill. We estimate what the same usage *would* cost on the Anthropic API, from a bundled price table in [`src/sources/claudeCode/pricing.json`](../src/sources/claudeCode/pricing.json):

```
cost = fresh_input·input
     + cache_read·(input × 0.1)
     + cache_write·(input × 1.25  [5m]  or  × 2  [1h])
     + output·output            ÷ 1,000,000
```

- `input`/`output` are base $/Mtok per model family (Fable, Opus, Sonnet, Haiku), matched by substring of the model id.
- Cache multipliers follow Anthropic's standard pricing (read 0.1×, 5-minute write 1.25×, 1-hour write 2× — selectable via `tokenLens.cacheWriteTtl`).
- Unknown models (no family match — e.g. `<synthetic>` entries) contribute tokens but **$0**, and the session/model is flagged `⚠ no price`.

These sessions are tagged `estimate`.

### Gemini CLI — API-equivalent estimate
Gemini CLI records token counts per call (`tokens.{input, output, cached, thoughts, tool}`) but **no cost**, so USD is estimated from a bundled Gemini price table in [`src/sources/geminiCli/pricing.json`](../src/sources/geminiCli/pricing.json):

```
fresh_input = max(0, input − cached) + tool      # tokens.input includes cached reads
output      = output + thoughts                   # thinking tokens billed at output rate
cost = fresh_input·input$ + cached·cacheRead$ + output·output$   ÷ 1,000,000
```

- Model families: 2.5 Pro / 2.5 Flash / 2.5 Flash-Lite / 2.0 Flash(-Lite) / 1.5 Pro / 1.5 Flash, matched most-specific-first by substring of the model id.
- Gemini uses **implicit caching**: cached reads are billed at ~25% of the input price and there is **no cache-write fee** — cache-write is always 0 for this source (the `cacheWriteTtl` setting does not apply).
- Prices use the ≤200k-token prompt tier; long-context (>200k) prompts on 2.5 Pro cost more in reality, so the estimate is a floor there.
- **Free tier**: if you use Gemini CLI with a free personal Google account, your real cost is $0 — the estimate is the API-equivalent value of that usage, not a bill.

These sessions are tagged `estimate`.

## Updating prices

When Anthropic changes prices, edit the `families` block in [`pricing.json`](../src/sources/claudeCode/pricing.json) (base input/output $/Mtok); for Gemini, edit [`src/sources/geminiCli/pricing.json`](../src/sources/geminiCli/pricing.json). Confirm current numbers at <https://platform.claude.com/docs/en/pricing> and <https://ai.google.dev/gemini-api/docs/pricing>. Copilot prices need no maintenance — they ride on the credit field in your logs.

## Caveats

- Credits/USD are only as complete as your logs: older Copilot sessions that predate `copilotUsageNanoAiu` show `—`/`≥`.
- The Claude Code and Gemini CLI estimates are API-list-price, not your actual subscription cost (Gemini free tier: $0); treat them as a relative signal, not a bill.
- Cache-write pricing assumes the configured TTL uniformly; mixed-TTL sessions are approximated. (Claude Code only — Gemini has no cache-write fee.)
