/**
 * @fileoverview Unified sync engine. Discovers sessions from every enabled source,
 * parses changed files incrementally, computes per-call cost, and persists.
 *
 * All sources normalize to the same call shape, so everything below is source-agnostic
 * except the pricing lookup (Copilot: per-session models.json; Claude Code and Gemini
 * CLI: bundled tables).
 */

const fs = require('fs');
const copilot = require('../sources/copilot');
const claudeCode = require('../sources/claudeCode');
const geminiCli = require('../sources/geminiCli');
const { computeCallCost } = require('../compute/cost');
const { getClaudePricing, getGeminiPricing } = require('../compute/pricing');
const log = require('../utils/logger');

const PARSER_VERSION = 6; // bump to force a full re-sync when parsing logic changes

/**
 * Analyze cache breaks across a session's calls (in order). A break = a call that had a
 * warm cache available (previous call read from cache) but itself read ~nothing from cache.
 * This mirrors what VS Code's Cache Explorer surfaces, derived from token counts + the
 * systemPromptFile/toolsFile sidecar references Copilot logs each request against.
 * @returns {{ total:number, causes:Object, tokens:number, tokenCauses:Object }}
 */
function analyzeCacheBreaks(calls) {
  const causes = { model_switch: 0, system_prompt_change: 0, tools_changed: 0, eviction: 0 };
  const tokenCauses = { model_switch: 0, system_prompt_change: 0, tools_changed: 0, eviction: 0 };
  let total = 0;
  let tokens = 0;
  let prev = null;
  let prevHadCache = false;

  for (const c of calls) {
    const denom = (c.inputFresh || 0) + (c.cacheRead || 0);
    const readRatio = denom > 0 ? (c.cacheRead || 0) / denom : 0;
    if (prevHadCache && denom > 2000 && readRatio < 0.05) {
      total++;
      let cause = 'eviction';
      if (prev && c.model !== prev.model) cause = 'model_switch';
      else if (prev && c.systemPromptFile && prev.systemPromptFile && c.systemPromptFile !== prev.systemPromptFile) cause = 'system_prompt_change';
      else if (prev && c.toolsFile && prev.toolsFile && c.toolsFile !== prev.toolsFile) cause = 'tools_changed';
      causes[cause]++;
      const tokenImpact = c.inputFresh || 0;
      tokens += tokenImpact;
      tokenCauses[cause] += tokenImpact;
    }
    prevHadCache = (c.cacheRead || 0) > 0;
    prev = c;
  }
  return { total, causes, tokens, tokenCauses };
}

/** Decide how trustworthy a session's cost figure is. */
function costConfidence(source, calls) {
  if (source === 'copilot') {
    const withAiu = calls.filter((c) => (c.aiu || 0) > 0).length;
    if (withAiu === 0) return 'none';        // no credit data -> we don't claim a USD figure
    if (withAiu === calls.length) return 'billed';
    return 'partial';                        // some calls lack credits -> floor, not exact
  }
  // Claude Code / Gemini CLI: priced from a bundled table -> an estimate (or none if
  // nothing matched).
  const anyPriced = calls.some((c) => (c.cost || 0) > 0);
  return anyPriced ? 'estimate' : 'none';
}

let _syncing = false;

/**
 * @param {import('./db').Database} db
 * @param {{sources:string[], claudeCodeHome?:string, geminiCliHome?:string, cacheWriteTtl?:string}} config
 * @returns {Promise<{synced:number, skipped:number, errors:number}>}
 */
async function fullSync(db, config) {
  if (_syncing) return { synced: 0, skipped: 0, errors: 0 };
  _syncing = true;
  const sources = config.sources || ['claudeCode', 'copilot', 'geminiCli'];
  let synced = 0, skipped = 0, errors = 0;

  try {
    const descriptors = [];
    if (sources.includes('claudeCode')) descriptors.push(...claudeCode.discover(config.claudeCodeHome));
    if (sources.includes('copilot')) descriptors.push(...copilot.discover());
    if (sources.includes('geminiCli')) descriptors.push(...geminiCli.discover(config.geminiCliHome));

    for (const d of descriptors) {
      try {
        const did = syncSession(db, d, config);
        if (did) { synced++; if (synced % 10 === 0) db.persist(); }
        else skipped++;
      } catch (err) {
        errors++;
        log.warn('sync error', d.sessionId, err.message);
      }
    }
    db.persist();
  } finally {
    _syncing = false;
  }
  log.log('fullSync done', { synced, skipped, errors });
  return { synced, skipped, errors };
}

/** Combined mtime/size signature across a session's files (main + sub-agents). */
function fileSignature(paths) {
  let mtime = 0, size = 0;
  for (const p of paths) {
    try {
      const st = fs.statSync(p);
      mtime = Math.max(mtime, Math.floor(st.mtimeMs));
      size += st.size;
    } catch { /* missing file */ }
  }
  return { mtime, size };
}

/** Sync one session; returns true if (re)synced, false if skipped/empty. */
function syncSession(db, d, config) {
  const files = [d.sourcePath, ...(d.subFiles || [])];
  const sig = fileSignature(files);
  if (sig.size === 0) return false;

  const existing = db.queryOne(
    'SELECT mtime, size, parser_version FROM sync_log WHERE file_path = $p',
    { $p: d.sourcePath }
  );
  if (existing && existing.mtime >= sig.mtime && existing.size === sig.size && existing.parser_version === PARSER_VERSION) {
    return false;
  }

  let parsed;
  if (d.source === 'copilot') parsed = copilot.parse(d.sourcePath);
  else if (d.source === 'geminiCli') parsed = geminiCli.parse(d.sourcePath, d.subFiles);
  else parsed = claudeCode.parse(d.sourcePath, d.subFiles);

  if (!parsed.calls.length) return false;

  // Pricing: per-source.
  const copilotPricing = d.source === 'copilot' ? copilot.loadPricing(d.modelsPath) : null;
  const isEstimate = d.source !== 'copilot';

  const agg = {
    input: 0, cacheRead: 0, cacheWrite: 0, output: 0, cost: 0, credits: 0,
    calls: 0, unknown: false, models: new Set(),
  };

  for (const call of parsed.calls) {
    // Cost basis differs by source:
    //  - Copilot bills via premium-request AI credits (copilotUsageNanoAiu). When present,
    //    USD = aiu/1e11 and credits = aiu/1e9. Older calls lack it -> fall back to token pricing.
    //  - Claude Code / Gemini CLI have no bill; we estimate API-equivalent USD from bundled
    //    price tables.
    call.credits = (call.aiu || 0) / 1e9;
    if (d.source === 'copilot') {
      // Only the AI-credit figure is trustworthy for Copilot. Calls without it contribute
      // tokens but no USD (we'd rather show no number than a wrong one).
      call.cost = call.aiu > 0 ? call.aiu / 1e11 : 0;
      if (!(call.aiu > 0) && !copilotPricing.get(call.model)) agg.unknown = true;
    } else {
      const pricing = d.source === 'geminiCli' ? getGeminiPricing(call.model) : getClaudePricing(call.model);
      if (!pricing) agg.unknown = true;
      call.cost = computeCallCost(call, pricing, { cacheWriteTtl: config.cacheWriteTtl });
    }
    agg.input += call.inputFresh;
    agg.cacheRead += call.cacheRead;
    agg.cacheWrite += call.cacheWrite;
    agg.output += call.output;
    agg.cost += call.cost;
    agg.credits += call.credits;
    agg.calls++;
    agg.models.add(call.model);
  }

  const workspace = d.source === 'claudeCode' ? (parsed.workspace || d.projectDirName) : d.workspace;
  const breaks = analyzeCacheBreaks(parsed.calls);
  const confidence = costConfidence(d.source, parsed.calls);

  db.transaction(() => {
    db.run('DELETE FROM llm_calls WHERE session_id = $s', { $s: d.sessionId });
    db.run('DELETE FROM sessions WHERE session_id = $s', { $s: d.sessionId });

    db.run(`INSERT INTO sessions (
      session_id, source, title, workspace, start_time, end_time, models_json,
      total_calls, input_tokens, cache_read_tokens, cache_write_tokens, output_tokens,
      cost_usd, ai_credits, is_estimate, cost_confidence, cache_breaks, cache_break_causes_json,
      cache_break_tokens, cache_break_token_causes_json, has_unknown_model, source_path, synced_at
    ) VALUES (
      $id, $src, $title, $ws, $st, $et, $models,
      $calls, $in, $cr, $cw, $out,
      $cost, $credits, $est, $conf, $breaks, $causes,
      $breakTokens, $tokenCauses, $unknown, $path, $now
    )`, {
      $id: d.sessionId,
      $src: d.source,
      $title: parsed.title || null,
      $ws: workspace || null,
      $st: parsed.firstTs,
      $et: parsed.lastTs,
      $models: JSON.stringify([...agg.models]),
      $calls: agg.calls,
      $in: agg.input,
      $cr: agg.cacheRead,
      $cw: agg.cacheWrite,
      $out: agg.output,
      $cost: agg.cost,
      $credits: agg.credits,
      $est: isEstimate ? 1 : 0,
      $conf: confidence,
      $breaks: breaks.total,
      $causes: JSON.stringify(breaks.causes),
      $breakTokens: breaks.tokens,
      $tokenCauses: JSON.stringify(breaks.tokenCauses),
      $unknown: agg.unknown ? 1 : 0,
      $path: d.sourcePath,
      $now: Math.floor(Date.now() / 1000),
    });

    for (const call of parsed.calls) {
      db.run(`INSERT INTO llm_calls (
        session_id, source, ts, model, input_tokens, cache_read_tokens,
        cache_write_tokens, output_tokens, cost_usd, ai_credits, is_estimate, is_subagent
      ) VALUES ($s, $src, $ts, $m, $in, $cr, $cw, $out, $cost, $credits, $est, $sub)`, {
        $s: d.sessionId,
        $src: d.source,
        $ts: call.ts,
        $m: call.model,
        $in: call.inputFresh,
        $cr: call.cacheRead,
        $cw: call.cacheWrite,
        $out: call.output,
        $cost: call.cost,
        $credits: call.credits || 0,
        $est: isEstimate ? 1 : 0,
        $sub: call.isSubagent ? 1 : 0,
      });
    }

    db.run(`INSERT OR REPLACE INTO sync_log (file_path, session_id, source, mtime, size, parser_version, synced_at)
      VALUES ($p, $s, $src, $mt, $sz, $pv, $now)`, {
      $p: d.sourcePath, $s: d.sessionId, $src: d.source,
      $mt: sig.mtime, $sz: sig.size, $pv: PARSER_VERSION,
      $now: Math.floor(Date.now() / 1000),
    });
  });

  return true;
}

module.exports = { fullSync, syncSession, analyzeCacheBreaks, PARSER_VERSION };
