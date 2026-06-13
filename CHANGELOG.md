# Changelog

All notable changes. Versions are `0.x` while in active development.

## 0.7.3

### Changed - metadata and content polish
- Updated Marketplace metadata wording for a cleaner, generic TokenLens description.
- Standardized README wording to a professional local-first tone.
- Replaced long-dash punctuation in key user-facing content with plain hyphen style.

## 0.7.2

### Fixed — layout & theming
- **Sessions table no longer overflows the window** — Title and Workspace columns now scale with the panel width, so Cost and When are always visible.
- **Light-theme readability** — badges (`⚠ no price`, `sub`) and all tile/bar backgrounds now derive from theme colors instead of dark-only values.
- Token deep dive: token types render as tiles (value + share), plus a colored cache-hit-rate bar.
- Zero-value cache-write tiles/columns are hidden for sources that never report them (Copilot, Gemini CLI).
- Session titles strip leading markdown (`**`, `#`, backticks) and clamp to one line.

## 0.7.1

### Changed — UI polish
- **Refreshed dashboard styling** — metric cards get a rounded look with a colored source accent and lift-on-hover; panel headers carry a small accent bar.
- **Stat tiles** — the Latest Session and Token deep-dive stats are now laid out as tidy responsive tiles instead of a flat row.
- **Latest Session panel** — clearer hero header with the source tag, title, and a "last active" time badge; accent-tinted border.
- **Token bar** — slightly taller, rounded, with crisper segment dividers.

### Fixed
- Gemini CLI session IDs now display without the internal `gm:` prefix in the Latest Session and session-detail views.

## 0.7.0

### Added — Gemini CLI as a third source
- **Gemini CLI tracking** — reads auto-saved session files from `~/.gemini/tmp/<project_hash>/chats/` (both the current `.jsonl` and legacy `.json` formats). Subagent transcripts are matched to their parent session. Workspace comes from the recorded `.project_root`.
- **Gemini cost estimates** — Gemini CLI doesn't record cost, so USD is an **≈ API-equivalent estimate** from a bundled Gemini price table (2.5 Pro/Flash/Flash-Lite, 2.0, 1.5 families). Gemini uses *implicit* caching: cached reads are billed at ~25% of input price and there is **no cache-write fee** — cache-write always shows 0 for this source. If you're on the free tier, the real cost is $0; hide estimates with `tokenLens.showEstimatedCost`.
- **New setting** `tokenLens.geminiCliHome` — override `~/.gemini` (or set `$GEMINI_CLI_HOME`).
- **UI** — Gemini CLI source filter, card, chart series (teal), legend entry, and source tag.
- **Marketplace icon** (`media/icon.png`, generated via `npm run make:icon`).

### Changed
- Display name is now **TokenLens — AI Usage & Cost**.
- Improved badge contrast (`sub` / `⚠` badges).
- Parser version bumped → first sync after upgrading re-reads all sessions once.

## 0.6.0

### Changed
- **Renamed to TokenLens** (display name, dashboard title, activity-bar, status bar, command titles).

### Added / Fixed
- **Cleaner titles** — a pasted URL no longer becomes the session title (leading URLs stripped, whitespace collapsed).
- **Richer Latest Session header** — shows the session id, started + last-active timestamps, and workspace chip alongside the title and source badge.
- **Cache-break token impact** — deep dive and expanded session rows now show how many fresh input tokens were re-sent on cache-break calls, including per-cause impact chips.
- **Richer expanded session rows** — expanded rows now include workspace, session id, started/last-active timestamps, and break-impact total above the per-model table.
- Removed the unreliable **Open Copilot chat** link; VS Code's internal chat-session URI can open a never-ending loading tab for local debug-log sessions, so TokenLens keeps the dependable **Open raw log** action.

## 0.5.0

### Added — cache-break cause classification
- Each cache break is now classified by **cause** — `model switch` / `sys-prompt change` / `tools changed` / `eviction (compaction/TTL)` — derived from the model id and Copilot's `systemPromptFile`/`toolsFile` sidecar references (the same signals VS Code's Cache Explorer uses).
- **Deep-dive panel** shows cache breaks by cause for the current window; **session detail** shows the per-session cause breakdown.
- See [docs/TOKENS-AND-CACHE.md](docs/TOKENS-AND-CACHE.md).

## 0.4.0

### Added — deeper VS Code integration
- **Persisted filters** — the selected time window, source, sort, and search now survive panel reloads and tab switches (webview state API).
- **Jump to source** — expand a session and click **Open raw log ↗** to open its JSONL in the editor.
- **Current-workspace marker** — sessions belonging to a folder open in this VS Code window are marked with a `●` accent chip (`workspace.workspaceFolders`).

### Fixed (0.3.1, folded in)
- Workspace shown as a **clean repo chip** (de-duplicated path, `.code-workspace` stripped) instead of raw nested paths.
- Per-model cost shows **`—`** for credit-less Copilot models instead of a misleading `$0.00`.
- Footer rewritten as a compact legend bar.

## 0.3.0

### Changed — cost you can trust
- **Token-first.** Cost is now shown only at the confidence level it deserves; tokens/cache stats are always exact.
- **Dropped the Copilot token-price fallback.** Copilot cost comes solely from premium-request **AI credits** (`copilotUsageNanoAiu`). Sessions without credit data show `—` (was a wrong ~37×-too-low number) or `≥` (floor) when only some calls carry credits.
- **Claude Code estimate** is clearly labeled `≈ … est` and can be hidden with `tokenLens.showEstimatedCost`.

### Added
- **Token deep-dive panel** — fresh/cached/cache-write/output proportion bar, cache efficiency, tokens served from cache, cache writes, and cache breaks.
- **Cache-break detection** per session (warm cache lost), aggregated over the time window; Copilot `systemPromptFile`/`toolsFile` captured for future cause classification.
- **Cost-confidence** model (`billed` / `partial` / `estimate` / `none`) on every session.
- **Documentation** — `docs/COST-METHODOLOGY.md`, `docs/TOKENS-AND-CACHE.md` (incl. relationship to VS Code's Agent Debug / Cache Explorer), `docs/ARCHITECTURE.md`.

### Fixed
- Workspace/repo names no longer show URL-encoding (`Sem%204` → `Sem 4`).
- Webview hardened: a failure in one panel can no longer blank the whole dashboard.

## 0.2.0

### Added
- **Time-window selector** (All / 6h / 12h / 24h / 48h / 72h / 7 days / custom) filtering every panel.
- **Per-model token split** (fresh/cached/cache-write/output) with color-coded cache-hit.
- **Sub-agent** and **unknown-model** badges.
- **Click-to-expand** session rows (inline per-model detail) and **sortable** columns.
- **Latest Session** panel.

### Fixed
- HiDPI canvas sizing bug that made the daily chart render oversized.

## 0.1.0

- Initial release. Unified Claude Code + Copilot tracking from local logs, sql.js storage, dashboard with cards/chart/tables, source filter, AI-credit cost for Copilot, API-equivalent estimate for Claude Code, budget alerts, live `fs.watch` tracking, CSV/JSON export.
