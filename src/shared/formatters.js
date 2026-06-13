/**
 * @fileoverview Pure formatting helpers shared by host and webview.
 */

function formatUSD(n) {
  if (n === null || n === undefined || isNaN(n)) return '$0.00';
  if (n > 0 && n < 0.01) return '<$0.01';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatTokens(n) {
  if (!n) return '0';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function formatPct(n) {
  if (n === null || n === undefined || isNaN(n)) return '0%';
  return Math.round(n) + '%';
}

/** YYYY-MM-DD in local time for a unix-seconds timestamp. */
function dayKey(unixSec) {
  const d = new Date(unixSec * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** ISO week key YYYY-Www for a unix-seconds timestamp. */
function weekKey(unixSec) {
  const d = new Date(unixSec * 1000);
  // Copy and shift to Thursday of the current week (ISO 8601).
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3);
  const week = 1 + Math.round((target - firstThursday) / (7 * 24 * 3600 * 1000));
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const SOURCE_LABELS = { claudeCode: 'Claude Code', copilot: 'Copilot' };
function sourceLabel(s) { return SOURCE_LABELS[s] || s; }

module.exports = { formatUSD, formatTokens, formatPct, dayKey, weekKey, sourceLabel };
