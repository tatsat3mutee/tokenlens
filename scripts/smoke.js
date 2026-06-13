/**
 * Manual smoke test: run the real sync against this machine's logs (no VS Code needed).
 *   node scripts/smoke.js
 */
const os = require('os');
const path = require('path');
const fs = require('fs');
const { Database } = require('../src/db/db');
const { fullSync } = require('../src/db/sync');
const queries = require('../src/db/queries');
const { getBudgetStatus } = require('../src/compute/budget');
const { formatUSD, formatTokens } = require('../src/shared/formatters');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aict-smoke-'));
  const db = new Database(dir);
  await db.init();

  const config = { sources: ['claudeCode', 'copilot', 'geminiCli'], cacheWriteTtl: '5m', 'budget.dailyUSD': 0, 'budget.weeklyUSD': 0 };
  console.time('fullSync');
  const result = await fullSync(db, config);
  console.timeEnd('fullSync');
  console.log('sync result:', result);

  console.log('\n=== Per-source totals ===');
  for (const t of queries.getTotals(db)) {
    const tok = t.input_tokens + t.cache_read_tokens + t.cache_write_tokens + t.output_tokens;
    console.log(`${t.source.padEnd(11)} sessions=${String(t.sessions).padStart(4)} calls=${String(t.calls).padStart(5)} tokens=${formatTokens(tok).padStart(8)} cost=${formatUSD(t.cost_usd).padStart(10)}${t.is_estimate ? ' (est)' : ''}`);
  }

  console.log('\n=== Top 5 models by cost ===');
  for (const m of queries.getModelBreakdown(db).slice(0, 5)) {
    console.log(`${m.source.padEnd(11)} ${String(m.model).padEnd(34)} calls=${String(m.calls).padStart(5)} cost=${formatUSD(m.cost_usd)}`);
  }

  console.log('\n=== 5 most recent sessions ===');
  for (const s of queries.getSessions(db).slice(0, 5)) {
    console.log(`[${s.source}] ${formatUSD(s.cost_usd).padStart(9)}  ${(s.title || '(untitled)').slice(0, 50)}`);
  }

  console.log('\n=== Per-model token split (top 3) ===');
  for (const m of queries.getModelBreakdown(db).slice(0, 3)) {
    console.log(`${String(m.model).padEnd(30)} fresh=${formatTokens(m.fresh)} cached=${formatTokens(m.cached)} cacheWr=${formatTokens(m.cache_write)} out=${formatTokens(m.output)} cost=${formatUSD(m.cost_usd)}${m.has_subagent ? ' [sub]' : ''}`);
  }

  const from24h = Math.floor(Date.now() / 1000) - 24 * 3600;
  console.log('\n=== Last 24h (windowed totals) ===');
  for (const t of queries.getTotals(db, { fromTs: from24h })) {
    console.log(`${t.source.padEnd(11)} calls=${t.calls} cost=${formatUSD(t.cost_usd)}`);
  }

  const latest = queries.getLatestSession(db);
  console.log('\n=== Latest session ===');
  if (latest) {
    const s = latest.session;
    console.log(`[${s.source}] ${formatUSD(s.cost_usd)} conf=${s.cost_confidence} cacheBreaks=${s.cache_breaks} — ${(s.title || '(untitled)').slice(0, 40)}`);
  }

  console.log('\n=== Cost confidence + cache breaks (all sessions) ===');
  for (const r of db.query("SELECT source, cost_confidence, COUNT(*) n, SUM(cache_breaks) breaks FROM sessions GROUP BY source, cost_confidence ORDER BY source")) {
    console.log(`${r.source.padEnd(11)} ${String(r.cost_confidence).padEnd(9)} sessions=${r.n} cacheBreaks=${r.breaks}`);
  }
  console.log('cache stats (all):', queries.getCacheStats(db));

  const b = getBudgetStatus(db, config);
  console.log('\n=== Budget snapshot ===');
  console.log('today:', formatUSD(b.day.usd), formatTokens(b.day.tokens), 'tokens | week:', formatUSD(b.week.usd));

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
})().catch(e => { console.error(e); process.exit(1); });
