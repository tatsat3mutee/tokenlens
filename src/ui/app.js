/* TokenLens — webview app (self-contained; no module imports). */
/* global acquireVsCodeApi */
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();

  // --- minimal RPC client matching shared/rpc.js host protocol ---
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m) return;
    if (m.type === 'rpc:response') {
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    } else if (m.type === 'rpc:notification') {
      (listeners.get(m.event) || []).forEach((cb) => cb(m.data));
    }
  });
  function call(method, params) {
    return new Promise((resolve, reject) => {
      const id = 'rpc:' + nextId++;
      pending.set(id, { resolve, reject });
      vscode.postMessage({ type: 'rpc:request', id, method, params });
    });
  }
  function on(event, cb) {
    if (!listeners.has(event)) listeners.set(event, []);
    listeners.get(event).push(cb);
  }

  // --- formatters ---
  const fmtUSD = (n) => (n == null || isNaN(n)) ? '$0.00' : (n > 0 && n < 0.01 ? '<$0.01' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const fmtTok = (n) => !n ? '0' : n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : '' + n;
  const SRC = { claudeCode: 'Claude Code', copilot: 'Copilot', geminiCli: 'Gemini CLI' };
  const SRC_ABBR = { claudeCode: 'cc', copilot: 'cp', geminiCli: 'gm' };
  const srcAbbr = (s) => SRC_ABBR[s] || 'cc';
  function when(ts) {
    if (!ts) return '—';
    const d = new Date(ts * 1000), diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 3600) return Math.max(1, Math.round(diff / 60)) + 'm ago';
    if (diff < 86400) return Math.round(diff / 3600) + 'h ago';
    return d.toLocaleDateString();
  }
  function fmtDateTime(ts) { return ts ? new Date(ts * 1000).toLocaleString() : '—'; }
  /** Strip a leading URL/markdown so a pasted link or **bold** prompt doesn't become a messy title. */
  function cleanTitle(t) {
    if (!t) return '(untitled)';
    let s = t
      .replace(/^\s*https?:\/\/\S+\s*/i, '') // leading URL
      .replace(/^[#>\s]+/, '')                  // leading heading / quote markers
      .replace(/\*\*|__|`/g, '')                // bold markers and code ticks
      .replace(/\s+/g, ' ').trim();
    return s || '(untitled)';
  }
  function shortId(sessionId) { return String(sessionId || '').replace(/^(cc:|cp:|gm:)/, ''); }
  function cacheHit(fresh, cached) {
    const denom = (fresh || 0) + (cached || 0);
    return denom > 0 ? Math.round((cached / denom) * 100) : 0;
  }
  function cacheClass(pct) { return pct >= 70 ? 'cache-good' : pct >= 40 ? 'cache-mid' : 'cache-bad'; }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function subBadge(has) { return has ? ' <span class="badge-sub" title="includes sub-agent calls">sub</span>' : ''; }
  const CAUSE_LABELS = {
    model_switch: 'Model switch',
    system_prompt_change: 'Sys-prompt change',
    tools_changed: 'Tools changed',
    eviction: 'Eviction / compaction',
  };
  function impactChips(causes, tokenCauses) {
    if (!causes) return '';
    return Object.keys(CAUSE_LABELS)
      .filter((k) => causes[k] > 0)
      .map((k) => `<span class="cause-chip">${CAUSE_LABELS[k]} <strong>${causes[k]}</strong> <span class="muted">${fmtTok(tokenCauses && tokenCauses[k])} re-sent</span></span>`)
      .join('');
  }
  function parseCauses(json) { try { return JSON.parse(json || '{}'); } catch { return {}; } }
  /** Per-model cost cell: dash when there's no reliable figure, ≈/est for estimates. */
  function modelCost(value, session) {
    if (!value) return '<span class="muted">—</span>';
    if (session && (session.cost_confidence === 'estimate' || session.is_estimate)) {
      return showEstimates ? `≈${fmtUSD(value)} <span class="est">est</span>` : '<span class="muted">—</span>';
    }
    return fmtUSD(value);
  }
  function unknownBadge(row) {
    const tok = (row.fresh || 0) + (row.cached || 0) + (row.cache_write || 0) + (row.output || 0);
    return (tok > 0 && !row.cost_usd && !row.ai_credits) ? ' <span class="badge-warn" title="no pricing data — excluded from cost">⚠ no price</span>' : '';
  }

  // --- state ---
  const saved = vscode.getState() || {};
  let currentSource = saved.source || '';
  let sessions = [];
  let sortKey = saved.sortKey || 'when', sortDir = saved.sortDir || -1;
  let showEstimates = true;
  let cacheStats = { breaks: 0 };
  let openFolders = [];
  const expanded = new Set();
  const sessionModelCache = new Map();

  function saveState() {
    vscode.setState({ source: currentSource, window: windowSel.value, sortKey, sortDir, search: $('search').value });
  }
  /** Does a session's workspace fall under a folder currently open in VS Code? */
  function inCurrentWorkspace(ws) {
    if (!ws || !openFolders.length) return false;
    const n = ws.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
    return openFolders.some((f) => {
      const ff = f.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
      return n === ff || n.startsWith(ff + '/') || ff.startsWith(n + '/');
    });
  }

  /** Render a cost cell honoring how trustworthy the figure is. */
  function costDisplay(value, confidence, isEstimate) {
    if (confidence === 'none') return '<span class="muted" title="no reliable cost data">—</span>';
    if (confidence === 'estimate' || (isEstimate && confidence == null)) {
      return showEstimates ? `≈${fmtUSD(value)} <span class="est">est</span>` : '<span class="muted" title="estimate hidden">—</span>';
    }
    if (confidence === 'partial') return `${fmtUSD(value)} <span class="est" title="lower bound — some calls lack credit data">≥</span>`;
    return fmtUSD(value);
  }

  const $ = (id) => document.getElementById(id);
  const windowSel = $('windowSel'), customRange = $('customRange'), fromDate = $('fromDate'), toDate = $('toDate');

  function windowRange() {
    const v = windowSel.value;
    if (v === 'custom') {
      const f = fromDate.value ? Math.floor(new Date(fromDate.value + 'T00:00:00').getTime() / 1000) : undefined;
      const t = toDate.value ? Math.floor(new Date(toDate.value + 'T23:59:59').getTime() / 1000) : undefined;
      return { fromTs: f, toTs: t };
    }
    const h = parseInt(v, 10);
    return h ? { fromTs: Math.floor(Date.now() / 1000) - h * 3600 } : {};
  }
  function params() { return Object.assign({ source: currentSource || undefined }, windowRange()); }

  // --- wiring ---
  $('sourceFilter').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    currentSource = btn.dataset.src || '';
    [...e.currentTarget.children].forEach((b) => b.classList.toggle('active', b === btn));
    saveState();
    refresh();
  });
  windowSel.addEventListener('change', () => {
    customRange.classList.toggle('hidden', windowSel.value !== 'custom');
    saveState();
    if (windowSel.value !== 'custom') refresh();
  });
  fromDate.addEventListener('change', () => { saveState(); refresh(); });
  toDate.addEventListener('change', () => { saveState(); refresh(); });
  $('syncBtn').addEventListener('click', () => call('triggerSync'));
  $('exportCsvBtn').addEventListener('click', () => call('export', Object.assign({ format: 'csv' }, params())));
  $('exportJsonBtn').addEventListener('click', () => call('export', Object.assign({ format: 'json' }, params())));
  $('search').addEventListener('input', () => { saveState(); renderSessions(); });

  document.querySelector('#sessionsTable thead').addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    const key = th.dataset.sort;
    if (sortKey === key) sortDir = -sortDir; else { sortKey = key; sortDir = key === 'title' || key === 'workspace' || key === 'source' ? 1 : -1; }
    saveState();
    renderSessions();
  });

  on('syncStart', () => setStatus('Syncing…'));
  on('syncComplete', () => { setStatus(''); refresh(); });

  function setStatus(msg) { const el = $('status'); el.textContent = msg; el.classList.toggle('hidden', !msg); }

  function safe(label, fn) {
    try { fn(); } catch (err) { console.error('[tokenlens] render ' + label + ' failed:', err); }
  }

  async function refresh() {
    try {
      sessionModelCache.clear();
      const p = params();
      const [dash, sess] = await Promise.all([call('getDashboard', p), call('getSessions', p)]);
      sessions = sess || [];
      showEstimates = !dash.settings || dash.settings.showEstimatedCost !== false;
      cacheStats = dash.cache || { breaks: 0 };
      openFolders = dash.workspaceFolders || [];
      safe('cards', () => renderCards(dash.totals || []));
      safe('deepdive', () => renderDeepDive(dash.totals || []));
      safe('latest', () => renderLatest(dash.latest));
      safe('budget', () => renderBudget(dash.budget));
      safe('models', () => renderModels(dash.models || []));
      safe('chart', () => renderChart(dash.daily || []));
      safe('sessions', () => renderSessions());
    } catch (err) {
      setStatus('Could not load data: ' + err.message);
      console.error('[tokenlens] refresh failed:', err);
    }
  }

  function totalsForView(totals) { return totals.filter((t) => !currentSource || t.source === currentSource); }

  function renderCards(totals) {
    const view = totalsForView(totals);
    const sum = (k) => view.reduce((a, t) => a + (t[k] || 0), 0);
    const tokens = sum('input_tokens') + sum('cache_read_tokens') + sum('cache_write_tokens') + sum('output_tokens');
    const cost = sum('cost_usd'), credits = sum('ai_credits');
    const hit = cacheHit(sum('input_tokens'), sum('cache_read_tokens'));
    const anyEstimate = view.some((t) => t.is_estimate);
    const costSub = credits > 0
      ? Math.round(credits).toLocaleString() + ' Copilot credits' + (anyEstimate ? ' + est' : '')
      : (anyEstimate ? 'incl. estimates' : 'billed');

    const cards = [
      { label: 'Total tokens', big: fmtTok(tokens), sub: sum('calls') + ' calls · ' + sum('sessions') + ' sessions' },
      { label: 'Total cost', big: fmtUSD(cost), sub: costSub },
      { label: 'Cache hit rate', big: hit + '%', sub: fmtTok(sum('cache_read_tokens')) + ' cached input' },
      { label: 'Output tokens', big: fmtTok(sum('output_tokens')), sub: fmtTok(sum('input_tokens')) + ' fresh input' },
    ];
    let perSource = '';
    if (!currentSource) {
      perSource = totals.map((t) => {
        const tk = (t.input_tokens || 0) + (t.cache_read_tokens || 0) + (t.cache_write_tokens || 0) + (t.output_tokens || 0);
        const extra = t.source === 'copilot' && t.ai_credits > 0 ? Math.round(t.ai_credits).toLocaleString() + ' credits' : fmtTok(tk) + ' tokens';
        return `<div class="card src-${srcAbbr(t.source)}"><div class="label">${SRC[t.source] || t.source}${t.is_estimate ? '<span class="badge">est</span>' : ''}</div>
          <div class="big">${costDisplay(t.cost_usd, t.cost_confidence, t.is_estimate)}</div><div class="sub">${extra} · ${t.sessions} sessions</div></div>`;
      }).join('');
    }
    $('cards').innerHTML = cards.map((c) => `<div class="card"><div class="label">${c.label}</div><div class="big">${c.big}</div><div class="sub">${c.sub}</div></div>`).join('') + perSource;
  }

  function renderDeepDive(totals) {
    const view = totalsForView(totals);
    const sum = (k) => view.reduce((a, t) => a + (t[k] || 0), 0);
    const fresh = sum('input_tokens'), cached = sum('cache_read_tokens'), cw = sum('cache_write_tokens'), out = sum('output_tokens');
    const total = fresh + cached + cw + out;
    const segs = [
      ['Fresh input', fresh, '#5aa0e0'],
      ['Cached read', cached, '#7ad17a'],
      ['Cache write', cw, '#e0a86a'],
      ['Output', out, '#c07ad1'],
    ];
    $('tokBar').innerHTML = total > 0
      ? segs.map(([, v, c]) => v > 0 ? `<span style="width:${(v / total * 100).toFixed(2)}%;background:${c}" title="${fmtTok(v)}"></span>` : '').join('')
      : '<span class="muted" style="padding:4px 8px">No token data in this window.</span>';
    $('tokLegend').innerHTML = segs.filter(([, v]) => v > 0 || total === 0).map(([n, v, c]) =>
      `<div class="tok-item" style="border-left-color:${c}">
        <span class="tok-name"><i class="dot" style="background:${c}"></i>${n}</span>
        <span class="tok-val">${fmtTok(v)}</span>
        <span class="tok-pct">${total ? (v / total * 100).toFixed(0) : 0}% of tokens</span>
      </div>`).join('');

    const efficiency = (fresh + cached) > 0 ? Math.round(cached / (fresh + cached) * 100) : 0;
    const lvl = efficiency >= 70 ? 'good' : efficiency >= 40 ? 'mid' : 'bad';
    $('hitRow').innerHTML = (fresh + cached) > 0
      ? `<span class="label">Cache hit rate</span><div class="hbar"><span class="hbar-${lvl}" style="width:${efficiency}%"></span></div><strong class="${cacheClass(efficiency)}">${efficiency}%</strong>`
      : '';
    const stats = [
      ['Served from cache', fmtTok(cached)],
      ...(cw > 0 ? [['Cache writes', fmtTok(cw)]] : []),
      ['Cache breaks', (cacheStats && cacheStats.breaks) || 0],
      ['Break impact', fmtTok((cacheStats && cacheStats.tokens) || 0)],
    ];
    $('tokStats').innerHTML = stats.map(([l, v]) => `<div><span class="label">${l}</span><span class="val">${v}</span></div>`).join('');

    const totalBreaks = (cacheStats && cacheStats.breaks) || 0;
    $('causeRow').innerHTML = totalBreaks > 0
      ? `<span class="muted">Cache-break token impact:</span> ${impactChips(cacheStats.causes, cacheStats.tokenCauses)}`
      : '<span class="muted">No cache breaks in this window — prompt caches stayed warm. 👍</span>';
  }

  function renderLatest(latest) {
    const panel = $('latestPanel');
    if (!latest || !latest.session) { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');
    const s = latest.session;
    const tok = (s.input_tokens || 0) + (s.cache_read_tokens || 0) + (s.cache_write_tokens || 0) + (s.output_tokens || 0);
    const hit = cacheHit(s.input_tokens, s.cache_read_tokens);
    const stats = [
      ['Cost', costDisplay(s.cost_usd, s.cost_confidence, s.is_estimate)],
      ['Tokens', fmtTok(tok)],
      ['Calls', s.total_calls],
      ['Cache hit', `<span class="${cacheClass(hit)}">${hit}%</span>`],
      ['Cache breaks', s.cache_breaks || 0],
      ['Break impact', fmtTok(s.cache_break_tokens || 0)],
    ];
    if (s.source === 'copilot' && s.ai_credits) stats.splice(1, 0, ['Credits', Math.round(s.ai_credits).toLocaleString()]);
    const models = (latest.models || []).map((m) => `<tr>
      <td>${esc(m.model)}${subBadge(m.has_subagent)}</td><td class="num">${m.calls}</td>
      <td class="num">${fmtTok(m.fresh)}</td><td class="num">${fmtTok(m.cached)}</td>
      <td class="num">${fmtTok(m.output)}</td><td class="num">${modelCost(m.cost_usd, s)}</td></tr>`).join('');
    const whenStr = when(s.end_time || s.start_time);
    $('latestBody').innerHTML = `
      <div class="latest-head">
        <span class="src-tag ${srcAbbr(s.source)}">${SRC[s.source] || s.source}</span>
        <strong class="latest-title" title="${esc(s.title || '')}">${esc(cleanTitle(s.title))}</strong>
        <span class="latest-when" title="last active ${esc(fmtDateTime(s.end_time))}">${whenStr}</span>
      </div>
      <div class="latest-meta muted">
        ${wsChip(s.workspace)}
        <span>session <code>${esc(shortId(s.session_id))}</code></span>
        <span>started ${fmtDateTime(s.start_time)}</span>
        <span>last active ${fmtDateTime(s.end_time)}</span>
      </div>
      <div class="ministats">${stats.map(([l, v]) => `<div><span class="label">${l}</span><span class="val">${v}</span></div>`).join('')}</div>
      <table class="mini"><thead><tr><th>Model</th><th class="num">Calls</th><th class="num">Fresh</th><th class="num">Cached</th><th class="num">Output</th><th class="num">Cost</th></tr></thead><tbody>${models}</tbody></table>`;
  }

  function renderBudget(budget) {
    const section = $('budgetSection');
    if (!budget) { section.classList.add('hidden'); return; }
    const a = renderBudgetRow('budgetDay', 'Today', budget.day);
    const b = renderBudgetRow('budgetWeek', 'This week', budget.week);
    section.classList.toggle('hidden', !(a || b));
  }
  function renderBudgetRow(id, label, b) {
    const el = $(id);
    if (!b || !b.limit || b.limit <= 0) { el.classList.add('hidden'); return false; }
    el.classList.remove('hidden');
    const pct = Math.min(100, Math.round((b.usd / b.limit) * 100)), over = b.usd >= b.limit;
    el.innerHTML = `<div><strong>${label}</strong> — ${fmtUSD(b.usd)} of ${fmtUSD(b.limit)} ${over ? '⚠️' : ''}</div>
      <div class="bar ${over ? 'over' : ''}"><span style="width:${pct}%"></span></div>`;
    return true;
  }

  function renderModels(models) {
    const tbody = document.querySelector('#modelsTable tbody');
    tbody.innerHTML = models.map((m) => {
      const hit = cacheHit(m.fresh, m.cached);
      let costCell;
      if (m.source === 'copilot' && m.ai_credits) costCell = `${fmtUSD(m.cost_usd)} <span class="est">${Math.round(m.ai_credits)}c</span>`;
      else if (m.cost_usd > 0) costCell = m.is_estimate && showEstimates ? `≈${fmtUSD(m.cost_usd)} <span class="est">est</span>` : (m.is_estimate ? '<span class="muted">—</span>' : fmtUSD(m.cost_usd));
      else costCell = '<span class="muted">—</span>';
      return `<tr>
        <td><span class="src-tag ${srcAbbr(m.source)}">${SRC[m.source] || m.source}</span></td>
        <td>${esc(m.model)}${subBadge(m.has_subagent)}${unknownBadge(m)}</td>
        <td class="num">${m.calls}</td>
        <td class="num">${fmtTok(m.fresh)}</td>
        <td class="num">${fmtTok(m.cached)}</td>
        <td class="num">${fmtTok(m.cache_write)}</td>
        <td class="num">${fmtTok(m.output)}</td>
        <td class="num"><span class="${cacheClass(hit)}">${hit}%</span></td>
        <td class="num">${costCell}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="9" class="muted">No data in this window — try “All time” or click Sync.</td></tr>';
  }

  function sessionTotalTokens(s) { return (s.input_tokens || 0) + (s.cache_read_tokens || 0) + (s.cache_write_tokens || 0) + (s.output_tokens || 0); }
  function sortValue(s) {
    switch (sortKey) {
      case 'source': return s.source;
      case 'title': return (s.title || '').toLowerCase();
      case 'workspace': return (s.workspace || '').toLowerCase();
      case 'tokens': return sessionTotalTokens(s);
      case 'cache': return cacheHit(s.input_tokens, s.cache_read_tokens);
      case 'cost_usd': return s.cost_usd || 0;
      default: return s.end_time || s.start_time || 0;
    }
  }

  function renderSessions() {
    const tbody = document.querySelector('#sessionsTable tbody');
    const filter = $('search').value.toLowerCase();
    let rows = sessions.filter((s) => !filter || ((s.title || '') + ' ' + (s.workspace || '')).toLowerCase().includes(filter));
    rows = rows.slice().sort((a, b) => {
      const va = sortValue(a), vb = sortValue(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * sortDir;
    });

    let html = '';
    for (const s of rows.slice(0, 300)) {
      const tok = sessionTotalTokens(s);
      const hit = cacheHit(s.input_tokens, s.cache_read_tokens);
      const open = expanded.has(s.session_id);
      html += `<tr class="srow ${open ? 'open' : ''}" data-id="${esc(s.session_id)}">
        <td><span class="src-tag ${srcAbbr(s.source)}">${SRC[s.source] || s.source}</span></td>
        <td class="title" title="${esc(s.title || '')}">${open ? '▾ ' : '▸ '}${esc(cleanTitle(s.title))}${subBadge(s.has_subagent)}${s.has_unknown_model ? ' <span class="badge-warn">⚠</span>' : ''}</td>
        <td class="ws">${wsChip(s.workspace)}</td>
        <td class="num">${fmtTok(tok)}</td>
        <td class="num"><span class="${cacheClass(hit)}">${hit}%</span></td>
        <td class="num">${costDisplay(s.cost_usd, s.cost_confidence, s.is_estimate)}</td>
        <td>${when(s.end_time || s.start_time)}</td></tr>`;
      if (open) html += `<tr class="detail-row" data-detail="${esc(s.session_id)}"><td colspan="7">${renderDetail(s.session_id)}</td></tr>`;
    }
    tbody.innerHTML = html || '<tr><td colspan="7" class="muted">No sessions in this window — try “All time” or click Sync.</td></tr>';
    updateSortIndicators();
  }

  function renderDetail(id) {
    const models = sessionModelCache.get(id);
    if (!models) return '<span class="muted">Loading…</span>';
    if (!models.length) return '<span class="muted">No model data.</span>';
    const s = sessions.find((x) => x.session_id === id);
    const detailMeta = s ? `<div class="detail-meta muted">
      ${wsChip(s.workspace)}
      <span>session <code>${esc(shortId(s.session_id))}</code></span>
      <span>started ${fmtDateTime(s.start_time)}</span>
      <span>last active ${fmtDateTime(s.end_time)}</span>
      <span>break impact <strong>${fmtTok(s.cache_break_tokens || 0)}</strong></span>
    </div>` : '';
    const causeLine = s && s.cache_breaks > 0
      ? `<div class="cause-row"><span class="muted">${s.cache_breaks} cache break(s):</span> ${impactChips(parseCauses(s.cache_break_causes_json), parseCauses(s.cache_break_token_causes_json))}</div>`
      : '';
    const actions = `<div class="detail-actions">
      <a class="lnk" data-act="openLog" data-id="${esc(id)}">Open raw log ↗</a>
    </div>`;
    const hasCw = models.some((m) => (m.cache_write || 0) > 0);
    return `${detailMeta}<table class="mini"><thead><tr><th>Model</th><th class="num">Calls</th><th class="num">Fresh</th><th class="num">Cached</th>${hasCw ? '<th class="num">Cache wr</th>' : ''}<th class="num">Output</th><th class="num">Cache hit</th><th class="num">Cost</th></tr></thead><tbody>${
      models.map((m) => { const h = cacheHit(m.fresh, m.cached); return `<tr><td>${esc(m.model)}${subBadge(m.has_subagent)}</td><td class="num">${m.calls}</td><td class="num">${fmtTok(m.fresh)}</td><td class="num">${fmtTok(m.cached)}</td>${hasCw ? `<td class="num">${fmtTok(m.cache_write)}</td>` : ''}<td class="num">${fmtTok(m.output)}</td><td class="num"><span class="${cacheClass(h)}">${h}%</span></td><td class="num">${modelCost(m.cost_usd, s)}</td></tr>`; }).join('')
    }</tbody></table>${causeLine}${actions}`;
  }

  document.querySelector('#sessionsTable tbody').addEventListener('click', async (e) => {
    const lnk = e.target.closest('.lnk');
    if (lnk) {
      e.stopPropagation();
      const sid = lnk.dataset.id;
      const sObj = sessions.find((x) => x.session_id === sid);
      if (lnk.dataset.act === 'openLog' && sObj) call('openLog', { path: sObj.source_path });
      return;
    }
    const row = e.target.closest('tr.srow');
    if (!row) return;
    const id = row.dataset.id;
    if (expanded.has(id)) { expanded.delete(id); renderSessions(); return; }
    expanded.add(id);
    renderSessions();
    if (!sessionModelCache.has(id)) {
      const models = await call('getSessionModels', { sessionId: id });
      sessionModelCache.set(id, models || []);
      if (expanded.has(id)) renderSessions();
    }
  });

  function updateSortIndicators() {
    document.querySelectorAll('#sessionsTable th[data-sort]').forEach((th) => {
      const base = th.textContent.replace(/[ ▲▼]+$/, '');
      th.textContent = th.dataset.sort === sortKey ? base + (sortDir > 0 ? ' ▲' : ' ▼') : base;
    });
  }

  /** Clean repo/workspace name: last path segment, de-duplicated, .code-workspace stripped. */
  function repoName(ws) {
    if (!ws) return '—';
    let parts = ws.replace(/\\/g, '/').split('/').filter(Boolean);
    parts = parts.filter((p, i) => i === 0 || p !== parts[i - 1]); // drop repeated segments
    let last = parts[parts.length - 1] || '';
    last = last.replace(/\.code-workspace$/i, '');
    return last || '—';
  }
  function wsChip(ws) {
    const here = inCurrentWorkspace(ws);
    const tip = (ws || '') + (here ? ' — open in this window' : '');
    return `<span class="ws-chip${here ? ' here' : ''}" title="${esc(tip)}">${here ? '● ' : ''}${esc(repoName(ws))}</span>`;
  }

  // --- canvas chart: stacked token bars per source + cost line ---
  function renderChart(daily) {
    const canvas = $('chart');
    const ctx = canvas.getContext('2d');
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(320, Math.round(rect.width)), cssH = 150;
    canvas.width = Math.round(cssW * ratio); canvas.height = Math.round(cssH * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const SRCS = ['claudeCode', 'copilot', 'geminiCli'];
    const COLORS = { claudeCode: '#d8915f', copilot: '#5aa0e0', geminiCli: '#4cc2b4' };
    const byDay = new Map();
    for (const r of daily) {
      if (!byDay.has(r.day)) byDay.set(r.day, { claudeCode: { t: 0, c: 0 }, copilot: { t: 0, c: 0 }, geminiCli: { t: 0, c: 0 } });
      const e = byDay.get(r.day);
      if (e[r.source]) { e[r.source].t += r.tokens || 0; e[r.source].c += r.cost_usd || 0; }
    }
    const days = [...byDay.keys()].sort().slice(-30);
    if (!days.length) { ctx.fillStyle = '#888'; ctx.font = '12px sans-serif'; ctx.fillText('No daily data in this window.', 10, 24); return; }

    const sumT = (d) => SRCS.reduce((a, s) => a + byDay.get(d)[s].t, 0);
    const sumC = (d) => SRCS.reduce((a, s) => a + byDay.get(d)[s].c, 0);
    const maxTok = Math.max(1, ...days.map(sumT));
    const maxCost = Math.max(0.0001, ...days.map(sumC));
    const padB = 18, padT = 8, h = cssH - padB - padT, bw = cssW / days.length, barW = Math.min(22, bw * 0.6);

    days.forEach((d, i) => {
      const e = byDay.get(d), x = i * bw + (bw - barW) / 2;
      let y = padT + h;
      for (const s of SRCS) {
        const segH = (e[s].t / maxTok) * h;
        y -= segH;
        ctx.fillStyle = COLORS[s]; ctx.fillRect(x, y, barW, segH);
      }
    });
    ctx.strokeStyle = '#7ad17a'; ctx.lineWidth = 1.5; ctx.beginPath();
    days.forEach((d, i) => {
      const cost = sumC(d), x = i * bw + bw / 2, y = padT + h - (cost / maxCost) * h;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = '#888'; ctx.font = '9px sans-serif';
    ctx.fillText(days[0].slice(5), 0, cssH - 4);
    ctx.fillText(days[days.length - 1].slice(5), cssW - 28, cssH - 4);
  }

  // Restore persisted filters (webview state survives reloads / tab hides).
  if (saved.window) { windowSel.value = saved.window; customRange.classList.toggle('hidden', saved.window !== 'custom'); }
  if (saved.search) $('search').value = saved.search;
  [...$('sourceFilter').children].forEach((b) => b.classList.toggle('active', (b.dataset.src || '') === currentSource));

  refresh();
})();
