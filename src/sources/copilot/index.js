/**
 * @fileoverview Copilot source: discover debug-log sessions and parse llm_request events.
 *
 * Copilot writes one main.jsonl per chat session under
 *   workspaceStorage/<hash>/GitHub.copilot-chat/debug-logs/<sid>/main.jsonl
 * Each line is an event; we read `type:"llm_request"` lines:
 *   attrs.{ model, inputTokens, outputTokens, cachedTokens? }, top-level ts (ms).
 * `inputTokens` INCLUDES cached tokens, so fresh = inputTokens - cachedTokens.
 */

const fs = require('fs');
const path = require('path');
const { getWorkspaceStoragePaths, decodeWorkspacePath } = require('./paths');

const SOURCE = 'copilot';

/** Discover all Copilot sessions across every workspaceStorage root. */
function discover() {
  const out = [];
  for (const base of getWorkspaceStoragePaths()) {
    let hashes;
    try {
      hashes = fs.readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
    } catch { continue; }

    for (const hash of hashes) {
      const debugLogsDir = path.join(base, hash, 'GitHub.copilot-chat', 'debug-logs');
      if (!fs.existsSync(debugLogsDir)) continue;

      const workspace = readWorkspacePath(path.join(base, hash, 'workspace.json'));

      let sids;
      try {
        sids = fs.readdirSync(debugLogsDir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);
      } catch { continue; }

      for (const sid of sids) {
        const sessionDir = path.join(debugLogsDir, sid);
        const mainJsonl = path.join(sessionDir, 'main.jsonl');
        if (!fs.existsSync(mainJsonl)) continue;
        out.push({
          source: SOURCE,
          sessionId: 'cp:' + sid,
          sourcePath: mainJsonl,
          workspace,
          modelsPath: path.join(sessionDir, 'models.json'),
        });
      }
    }
  }
  return out;
}

function readWorkspacePath(wsJsonPath) {
  try {
    if (!fs.existsSync(wsJsonPath)) return null;
    const data = JSON.parse(fs.readFileSync(wsJsonPath, 'utf-8'));
    return decodeWorkspacePath(data.workspace || data.folder || '');
  } catch {
    return null;
  }
}

/**
 * Parse a Copilot main.jsonl into normalized calls.
 * @returns {{title:string|null, calls:Array, models:string[], firstTs:number|null, lastTs:number|null}}
 */
function parse(mainJsonlPath) {
  const result = { title: null, calls: [], models: [], firstTs: null, lastTs: null };
  let content;
  try {
    content = fs.readFileSync(mainJsonlPath, 'utf-8');
  } catch {
    return result;
  }
  const models = new Set();

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }

    if (ev.type === 'user_message' && !result.title) {
      result.title = firstText(ev.attrs && (ev.attrs.text || ev.attrs.message || ev.attrs.content));
    }

    if (ev.type !== 'llm_request' || !ev.attrs) continue;
    const a = ev.attrs;
    const tsSec = ev.ts ? Math.floor(ev.ts / 1000) : null;
    const input = a.inputTokens || 0;
    const cached = a.cachedTokens || 0;
    const model = a.model || 'unknown';
    models.add(model);

    result.calls.push({
      ts: tsSec,
      model,
      inputFresh: Math.max(0, input - cached),
      cacheRead: cached,
      cacheWrite: 0,
      output: a.outputTokens || 0,
      aiu: a.copilotUsageNanoAiu || 0, // nano-AI-units; credits = aiu/1e9, USD = aiu/1e11
      systemPromptFile: a.systemPromptFile || null, // for cache-break cause (Cache Explorer signal)
      toolsFile: a.toolsFile || null,
      isSubagent: false,
    });

    if (tsSec != null) {
      if (result.firstTs == null || tsSec < result.firstTs) result.firstTs = tsSec;
      if (result.lastTs == null || tsSec > result.lastTs) result.lastTs = tsSec;
    }
  }

  result.models = [...models];
  return result;
}

function firstText(v) {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 200);
  return null;
}

/**
 * Parse a session models.json into a pricing map: modelId -> { input, output, cacheRead } in $/Mtok.
 * Prices in models.json are $/Mtok * 1e4 (e.g. 200 => $0.02/Mtok).
 */
function loadPricing(modelsJsonPath) {
  const map = new Map();
  try {
    if (!fs.existsSync(modelsJsonPath)) return map;
    const raw = JSON.parse(fs.readFileSync(modelsJsonPath, 'utf-8'));
    if (!Array.isArray(raw)) return map;
    for (const entry of raw) {
      const id = entry.id;
      const prices = entry.billing && entry.billing.token_prices && entry.billing.token_prices.default;
      if (!id || !prices) continue;
      map.set(id, {
        input: (prices.input_price || 0) / 1e4,
        output: (prices.output_price || 0) / 1e4,
        cacheRead: (prices.cache_price || 0) / 1e4,
      });
    }
  } catch { /* ignore malformed */ }
  return map;
}

module.exports = { discover, parse, loadPricing, SOURCE };
