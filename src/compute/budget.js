/**
 * @fileoverview Budget tracking. Sums today's and this week's combined spend
 * (Claude Code estimate + Copilot billed) and fires a one-shot alert per period.
 */

const { dayKey, weekKey } = require('../shared/formatters');

function startOfDay(d = new Date()) {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  return Math.floor(s.getTime() / 1000);
}

function startOfWeek(d = new Date()) {
  const day = (d.getDay() + 6) % 7; // Monday = 0
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day, 0, 0, 0, 0);
  return Math.floor(s.getTime() / 1000);
}

/** Sum cost + tokens over calls with ts >= fromTs. */
function rangeTotals(db, fromTs) {
  const row = db.queryOne(`
    SELECT COALESCE(SUM(cost_usd),0) AS usd,
           COALESCE(SUM(input_tokens + cache_read_tokens + cache_write_tokens + output_tokens),0) AS tokens
    FROM llm_calls WHERE ts IS NOT NULL AND ts >= $from
  `, { $from: fromTs });
  return { usd: row.usd || 0, tokens: row.tokens || 0 };
}

/** Snapshot for the dashboard / status bar. */
function getBudgetStatus(db, config) {
  const day = rangeTotals(db, startOfDay());
  const week = rangeTotals(db, startOfWeek());
  return {
    day: { ...day, limit: config['budget.dailyUSD'] || 0 },
    week: { ...week, limit: config['budget.weeklyUSD'] || 0 },
  };
}

/**
 * Return alerts to fire (and record them so each period notifies once).
 * @returns {Array<{period:string, limit:number, spent:number}>}
 */
function checkBudgets(db, config) {
  const alerts = [];
  const now = new Date();
  const checks = [
    { kind: 'day', limit: config['budget.dailyUSD'] || 0, from: startOfDay(now), key: `day:${dayKey(Math.floor(now / 1000))}:usd` },
    { kind: 'week', limit: config['budget.weeklyUSD'] || 0, from: startOfWeek(now), key: `week:${weekKey(Math.floor(now / 1000))}:usd` },
  ];

  for (const c of checks) {
    if (!c.limit || c.limit <= 0) continue;
    const { usd } = rangeTotals(db, c.from);
    if (usd < c.limit) continue;
    const already = db.queryOne('SELECT 1 FROM budget_alerts WHERE period_key = $k', { $k: c.key });
    if (already) continue;
    db.run('INSERT OR REPLACE INTO budget_alerts (period_key, notified_at) VALUES ($k, $t)', {
      $k: c.key, $t: Math.floor(Date.now() / 1000),
    });
    alerts.push({ period: c.kind, limit: c.limit, spent: usd });
  }
  return alerts;
}

module.exports = { getBudgetStatus, checkBudgets, rangeTotals, startOfDay, startOfWeek };
