/**
 * @fileoverview Build CSV / JSON export payloads from session rows.
 */

const { getExportRows } = require('../db/queries');

const COLUMNS = [
  'source', 'session_id', 'title', 'workspace', 'start_time', 'end_time',
  'total_calls', 'input_tokens', 'cache_read_tokens', 'cache_write_tokens',
  'output_tokens', 'cache_breaks', 'cache_break_tokens', 'cost_usd', 'ai_credits', 'is_estimate',
];

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * @param {import('../db/db').Database} db
 * @param {{format:'csv'|'json', source?:string, fromTs?:number, toTs?:number}} opts
 * @returns {{data:string, mimeType:string, filename:string}}
 */
function buildExport(db, opts = {}) {
  const rows = getExportRows(db, opts);
  const stamp = new Date().toISOString().slice(0, 10);

  if (opts.format === 'csv') {
    const header = COLUMNS.join(',');
    const body = rows.map(r => COLUMNS.map(c => csvEscape(toIso(r, c))).join(',')).join('\n');
    return { data: header + '\n' + body + '\n', mimeType: 'text/csv', filename: `tokenlens-${stamp}.csv` };
  }

  const json = rows.map(r => {
    const o = {};
    for (const c of COLUMNS) o[c] = toIso(r, c);
    return o;
  });
  return { data: JSON.stringify(json, null, 2), mimeType: 'application/json', filename: `tokenlens-${stamp}.json` };
}

function toIso(row, col) {
  if ((col === 'start_time' || col === 'end_time') && row[col]) {
    return new Date(row[col] * 1000).toISOString();
  }
  return row[col];
}

module.exports = { buildExport };
