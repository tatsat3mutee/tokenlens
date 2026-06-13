# TokenLens — AI Usage & Cost

> AI usage & cost tracker for Claude Code, GitHub Copilot, and Gemini CLI — 100% local.

A VS Code extension that tracks **token usage for Claude Code, GitHub Copilot, and Gemini CLI** in one place — token-first, with cost shown only when it's trustworthy. Unified dashboard, time-window filtering, token/cache deep dives, cache-break impact, budgets, live updates, and CSV/JSON export.

## 🔒 100% local — no cloud, no telemetry

**Your data never leaves your machine.** TokenLens reads the log files your AI tools already write to disk, computes everything **locally**, and stores results in a local SQLite file inside VS Code's own storage. There are **no servers, no accounts, no network calls, and no telemetry** — TokenLens works fully offline. Source logs are opened **read-only** and are never modified.

> Token-first by design. AI tools don't bill the same way — Copilot meters *premium-request credits*, Claude Code is a *flat subscription*, Gemini CLI is often *free-tier*. So this extension leads with **tokens and cache behavior** (always exact) and only shows a dollar figure when it can stand behind it. See [Cost methodology](docs/COST-METHODOLOGY.md).

---

## Features

### Unified dashboard
- **Per-source cards** — tokens, cost (with confidence), credits, and cache-hit for Claude Code, Copilot, and Gemini CLI side by side.
- **Time window** — All time / 6h / 12h / 24h / 48h / 72h / 7 days / custom date range; filters every panel.
- **Source filter** — All / Claude Code / Copilot / Gemini CLI.
- **Daily chart** — stacked token bars per source + a combined cost line.

### Token & cache deep dive
- **Token breakdown** — fresh input · cached read · cache write · output, as a proportion bar with counts and %.
- **Cache efficiency**, **tokens served from cache**, **cache writes**, and **cache breaks** (when a warm prompt cache was lost). See [Tokens & cache](docs/TOKENS-AND-CACHE.md).
- **By-model table** — per-model token split + color-coded cache-hit; `sub` badge for sub-agent calls; `⚠ no price` for unpriced models.

### Sessions
- **Latest Session** panel — most recent session's stats + per-model mini-table, auto-refreshing.
- **All sessions** — sortable columns; **click a row** to expand an inline per-model breakdown. `sub` / `⚠` badges.

### Cost — only when trustworthy
- **Copilot** → premium-request **AI credits** (`copilotUsageNanoAiu`, $0.01/credit). `≥` marks a floor when some calls predate the credit field.
- **Claude Code / Gemini CLI** → **≈ API-equivalent estimate** from bundled price tables (you likely pay a flat subscription — or nothing on Gemini's free tier — so it's labeled `est`; hide it with `tokenLens.showEstimatedCost`).
- **`—`** → no reliable cost; tokens are shown instead. Unpriced models are excluded from totals.

### Budgets, live, export
- **Budget alerts** — daily/weekly USD thresholds; one VS Code warning per period; status bar shows today's tokens / ≈USD.
- **Live tracking** — watches all log roots (`fs.watch`) and refreshes within ~2s as you work.
- **Export** — CSV/JSON of sessions (window- and source-filtered) from the dashboard or the command palette.

---

## Where the data comes from / where it's stored

| | Claude Code | GitHub Copilot | Gemini CLI |
|---|---|---|---|
| Source logs (read-only) | `~/.claude/projects/<cwd>/<uuid>.jsonl` (+ `…/<uuid>/subagents/agent-*.jsonl`) | VS Code `workspaceStorage/<hash>/GitHub.copilot-chat/debug-logs/<sid>/main.jsonl` (+ `system_prompt_*.json`, `tools_*.json`, `models.json`) | `~/.gemini/tmp/<project_hash>/chats/session-*.json(l)` (+ subagent files) |
| Per-call usage | `message.usage.{input_tokens, cache_read_input_tokens, cache_creation_input_tokens, output_tokens}` | `attrs.{inputTokens, cachedTokens, outputTokens, copilotUsageNanoAiu, systemPromptFile, toolsFile}` | `tokens.{input, output, cached, thoughts, tool}` |
| Cost signal | bundled Anthropic price table → estimate | `copilotUsageNanoAiu` → credits → USD | bundled Gemini price table → estimate |

Computed data lives in a local `sql.js` SQLite file under the extension's VS Code `globalStorage` (`ai-cost.db`). Source logs are never modified. See [Architecture](docs/ARCHITECTURE.md).

## Privacy

TokenLens is **local-first and offline by design**:

- **No network.** Nothing is uploaded, no analytics, no telemetry, no accounts or sign-in. The extension makes zero outbound requests.
- **Read-only.** Your AI tool logs are opened read-only; TokenLens never edits or deletes them.
- **Local storage only.** All computed data stays in a SQLite file inside VS Code's `globalStorage` on your disk. Uninstalling clears it.
- **No bundled secrets.** Pricing tables ship with the extension; no API keys are used or required.
- **Open source.** Audit every line — see the [repository](https://github.com/tatsat3mutee/tokenlens).

## Install / develop

```bash
npm install
npm test                 # vitest unit tests
node scripts/smoke.js    # end-to-end sync against your real logs, prints totals
npm run dev:vscode       # package .vsix and install into VS Code
# or press F5 in VS Code for an Extension Development Host
```

Open the dashboard from the activity-bar icon, the status bar item, or `TokenLens: Open Dashboard`.

## Settings

| Setting | Default | Description |
|---|---|---|
| `tokenLens.sources` | `["claudeCode","copilot","geminiCli"]` | Which tools to track. |
| `tokenLens.autoSyncOnStartup` | `true` | Sync on VS Code start. |
| `tokenLens.liveTracking` | `true` | Watch logs and refresh as you work. |
| `tokenLens.claudeCodeHome` | `""` | Override `~/.claude` (or set `$CLAUDE_CONFIG_DIR`). |
| `tokenLens.geminiCliHome` | `""` | Override `~/.gemini` (or set `$GEMINI_CLI_HOME`). |
| `tokenLens.cacheWriteTtl` | `5m` | Cache-write pricing tier for Claude Code estimates (5m = 1.25×, 1h = 2×). |
| `tokenLens.showEstimatedCost` | `true` | Show Claude Code / Gemini CLI estimates. Off → tokens only, no USD. |
| `tokenLens.budget.dailyUSD` / `weeklyUSD` | `0` | Spend thresholds (0 = off). |
| `tokenLens.debugLogging` | `false` | Verbose output channel. |

## Docs

- [Architecture](docs/ARCHITECTURE.md) — modules, data flow, schema.
- [Cost methodology](docs/COST-METHODOLOGY.md) — how cost is computed and the confidence levels.
- [Tokens & cache](docs/TOKENS-AND-CACHE.md) — token types, cache breaks, and the relationship to VS Code's Agent Debug / Cache Explorer.
- [Changelog](CHANGELOG.md).

## License

[MIT](LICENSE).
