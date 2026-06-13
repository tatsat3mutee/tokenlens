/**
 * @fileoverview Read queries for the dashboard, status bar, and export.
 * Optional filters: `source` ('claudeCode'|'copilot'|'geminiCli'|undefined) and a time window
 * (`fromTs`/`toTs`, unix seconds). When the window is omitted, all data is returned
 * (including calls whose timestamp is null).
 */

/** Build a WHERE clause for llm_calls filtered by source + time window. */
function callFilter({ source, fromTs, toTs } = {}) {
  const c = [];
  const p = {};
  if (source) { c.push('source = $source'); p.$source = source; }
  if (fromTs) { c.push('ts >= $from'); p.$from = fromTs; }
  if (toTs) { c.push('ts <= $to'); p.$to = toTs; }
  return { where: c.length ? 'WHERE ' + c.join(' AND ') : '', params: p };
}

/** Per-source totals (window-aware, computed from calls). */
function getTotals(db, opts = {}) {
  const { where, params } = callFilter(opts);
  return db.query(`
    SELECT source,
      COUNT(DISTINCT session_id) AS sessions,
      COUNT(*) AS calls,
      COALESCE(SUM(input_tokens),0) AS input_tokens,
      COALESCE(SUM(cache_read_tokens),0) AS cache_read_tokens,
      COALESCE(SUM(cache_write_tokens),0) AS cache_write_tokens,
      COALESCE(SUM(output_tokens),0) AS output_tokens,
      COALESCE(SUM(cost_usd),0) AS cost_usd,
      COALESCE(SUM(ai_credits),0) AS ai_credits,
      MAX(is_estimate) AS is_estimate
    FROM llm_calls ${where}
    GROUP BY source
  `, Object.keys(params).length ? params : undefined);
}

/** Session list (window-aware), with a has_subagent flag. */
function getSessions(db, { source, fromTs, toTs } = {}) {
  const c = [];
  const p = {};
  if (source) { c.push('s.source = $source'); p.$source = source; }
  if (fromTs) { c.push('COALESCE(s.end_time, s.start_time, 0) >= $from'); p.$from = fromTs; }
  if (toTs) { c.push('COALESCE(s.start_time, 0) <= $to'); p.$to = toTs; }
  const where = c.length ? 'WHERE ' + c.join(' AND ') : '';
  return db.query(`
    SELECT s.session_id, s.source, s.title, s.workspace, s.start_time, s.end_time, s.models_json,
           s.total_calls, s.input_tokens, s.cache_read_tokens, s.cache_write_tokens,
           s.output_tokens, s.cost_usd, s.ai_credits, s.is_estimate, s.cost_confidence,
           s.cache_breaks, s.cache_break_causes_json, s.cache_break_tokens,
           s.cache_break_token_causes_json, s.has_unknown_model, s.source_path,
           EXISTS(SELECT 1 FROM llm_calls c WHERE c.session_id = s.session_id AND c.is_subagent = 1) AS has_subagent
    FROM sessions s ${where}
    ORDER BY COALESCE(s.end_time, s.start_time, 0) DESC
    LIMIT 500
  `, Object.keys(p).length ? p : undefined);
}

/** Daily cost + token series per source (window-aware). */
function getDailySeries(db, opts = {}) {
  const { where, params } = callFilter(opts);
  const clause = where ? where + ' AND ts IS NOT NULL' : 'WHERE ts IS NOT NULL';
  return db.query(`
    SELECT source,
      strftime('%Y-%m-%d', ts, 'unixepoch', 'localtime') AS day,
      COALESCE(SUM(cost_usd),0) AS cost_usd,
      COALESCE(SUM(input_tokens + cache_read_tokens + cache_write_tokens + output_tokens),0) AS tokens
    FROM llm_calls ${clause}
    GROUP BY source, day
    ORDER BY day ASC
  `, Object.keys(params).length ? params : undefined);
}

/** Per-model breakdown with full token split (window-aware). */
function getModelBreakdown(db, opts = {}) {
  const { where, params } = callFilter(opts);
  return db.query(`
    SELECT source, model,
      COUNT(*) AS calls,
      COALESCE(SUM(input_tokens),0) AS fresh,
      COALESCE(SUM(cache_read_tokens),0) AS cached,
      COALESCE(SUM(cache_write_tokens),0) AS cache_write,
      COALESCE(SUM(output_tokens),0) AS output,
      COALESCE(SUM(cost_usd),0) AS cost_usd,
      COALESCE(SUM(ai_credits),0) AS ai_credits,
      MAX(is_estimate) AS is_estimate,
      MAX(is_subagent) AS has_subagent
    FROM llm_calls ${where}
    GROUP BY source, model
    ORDER BY cost_usd DESC
  `, Object.keys(params).length ? params : undefined);
}

/** Per-model breakdown for a single session (for expandable rows). */
function getSessionModels(db, sessionId) {
  return db.query(`
    SELECT model,
      COUNT(*) AS calls,
      COALESCE(SUM(input_tokens),0) AS fresh,
      COALESCE(SUM(cache_read_tokens),0) AS cached,
      COALESCE(SUM(cache_write_tokens),0) AS cache_write,
      COALESCE(SUM(output_tokens),0) AS output,
      COALESCE(SUM(cost_usd),0) AS cost_usd,
      COALESCE(SUM(ai_credits),0) AS ai_credits,
      MAX(is_subagent) AS has_subagent
    FROM llm_calls WHERE session_id = $s
    GROUP BY model ORDER BY cost_usd DESC
  `, { $s: sessionId });
}

/** Most recent session (optionally per source) + its per-model breakdown. */
function getLatestSession(db, { source } = {}) {
  const session = db.queryOne(`
    SELECT session_id, source, title, workspace, start_time, end_time, models_json,
           total_calls, input_tokens, cache_read_tokens, cache_write_tokens,
           output_tokens, cost_usd, ai_credits, is_estimate, cost_confidence,
           cache_breaks, cache_break_causes_json, cache_break_tokens,
           cache_break_token_causes_json, has_unknown_model
    FROM sessions ${source ? 'WHERE source = $source' : ''}
    ORDER BY COALESCE(end_time, start_time, 0) DESC LIMIT 1
  `, source ? { $source: source } : undefined);
  if (!session) return null;
  return { session, models: getSessionModels(db, session.session_id) };
}

/** Aggregate cache-break count across sessions in the window (by start_time). */
function getCacheStats(db, { source, fromTs, toTs } = {}) {
  const c = [];
  const p = {};
  if (source) { c.push('source = $source'); p.$source = source; }
  if (fromTs) { c.push('COALESCE(end_time, start_time, 0) >= $from'); p.$from = fromTs; }
  if (toTs) { c.push('COALESCE(start_time, 0) <= $to'); p.$to = toTs; }
  const where = c.length ? 'WHERE ' + c.join(' AND ') : '';
  const rows = db.query(`
    SELECT cache_breaks, cache_break_causes_json, cache_break_tokens, cache_break_token_causes_json FROM sessions ${where}
  `, Object.keys(p).length ? p : undefined);
  const causes = { model_switch: 0, system_prompt_change: 0, tools_changed: 0, eviction: 0 };
  const tokenCauses = { model_switch: 0, system_prompt_change: 0, tools_changed: 0, eviction: 0 };
  let breaks = 0;
  let tokens = 0;
  for (const r of rows) {
    breaks += r.cache_breaks || 0;
    tokens += r.cache_break_tokens || 0;
    if (r.cache_break_causes_json) {
      try {
        const c2 = JSON.parse(r.cache_break_causes_json);
        for (const k of Object.keys(causes)) causes[k] += c2[k] || 0;
      } catch { /* ignore malformed */ }
    }
    if (r.cache_break_token_causes_json) {
      try {
        const c3 = JSON.parse(r.cache_break_token_causes_json);
        for (const k of Object.keys(tokenCauses)) tokenCauses[k] += c3[k] || 0;
      } catch { /* ignore malformed */ }
    }
  }
  return { breaks, tokens, sessions: rows.length, causes, tokenCauses };
}

/** Flat rows for export (window-aware). */
function getExportRows(db, { source, fromTs, toTs } = {}) {
  const c = [];
  const p = {};
  if (source) { c.push('s.source = $source'); p.$source = source; }
  if (fromTs) { c.push('COALESCE(s.start_time,0) >= $from'); p.$from = fromTs; }
  if (toTs) { c.push('COALESCE(s.start_time,0) <= $to'); p.$to = toTs; }
  const where = c.length ? 'WHERE ' + c.join(' AND ') : '';
  return db.query(`
    SELECT s.source, s.session_id, s.title, s.workspace, s.start_time, s.end_time,
           s.models_json, s.total_calls, s.input_tokens, s.cache_read_tokens,
           s.cache_write_tokens, s.output_tokens, s.cost_usd, s.ai_credits, s.is_estimate,
           s.cache_breaks, s.cache_break_tokens
    FROM sessions s ${where}
    ORDER BY COALESCE(s.start_time,0) ASC
  `, Object.keys(p).length ? p : undefined);
}

module.exports = {
  getTotals, getSessions, getDailySeries, getModelBreakdown,
  getSessionModels, getLatestSession, getCacheStats, getExportRows,
};
