/**
 * @fileoverview TokenLens — extension entry point.
 * Wires the DB, sync engine, live watcher, budget alerts, status bar, and webview.
 */

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

const { Database } = require('./db/db');
const { fullSync } = require('./db/sync');
const queries = require('./db/queries');
const { getBudgetStatus, checkBudgets } = require('./compute/budget');
const { buildExport } = require('./compute/exportReport');
const { Watcher } = require('./watch/watcher');
const { createHostRpc } = require('./shared/rpc');
const { setGlobalStorageBase } = require('./sources/copilot/paths');
const { formatUSD, formatTokens } = require('./shared/formatters');
const logger = require('./utils/logger');

const PANEL_VIEW_TYPE = 'tokenLens.panel';
const CONFIG_NS = 'tokenLens';
const LEGACY_CONFIG_NS = 'aiCostTracker';
const COMMANDS = {
  openPanel: 'tokenLens.openPanel',
  refresh: 'tokenLens.refresh',
  export: 'tokenLens.export',
  legacyOpenPanel: 'aiCostTracker.openPanel',
  legacyRefresh: 'aiCostTracker.refresh',
  legacyExport: 'aiCostTracker.export',
};
const VIEWS = {
  panel: 'tokenLensPanel',
};

let db = null;
let panel = null;
let rpc = null;
let watcher = null;
let statusBar = null;
let outputChannel = null;
let syncing = false;

function hasUserConfigValue(config, key) {
  const i = config.inspect(key);
  if (!i) return false;
  return i.globalValue !== undefined || i.workspaceValue !== undefined || i.workspaceFolderValue !== undefined;
}

function getConfigValue(key, fallback) {
  const modern = vscode.workspace.getConfiguration(CONFIG_NS);
  const legacy = vscode.workspace.getConfiguration(LEGACY_CONFIG_NS);
  if (hasUserConfigValue(modern, key)) return modern.get(key, fallback);
  if (hasUserConfigValue(legacy, key)) return legacy.get(key, fallback);
  return modern.get(key, legacy.get(key, fallback));
}

function readConfig() {
  return {
    sources: getConfigValue('sources', ['claudeCode', 'copilot', 'geminiCli']),
    autoSyncOnStartup: getConfigValue('autoSyncOnStartup', true),
    liveTracking: getConfigValue('liveTracking', true),
    claudeCodeHome: getConfigValue('claudeCodeHome', '') || undefined,
    geminiCliHome: getConfigValue('geminiCliHome', '') || undefined,
    cacheWriteTtl: getConfigValue('cacheWriteTtl', '5m'),
    showEstimatedCost: getConfigValue('showEstimatedCost', true),
    'budget.dailyUSD': getConfigValue('budget.dailyUSD', 0),
    'budget.weeklyUSD': getConfigValue('budget.weeklyUSD', 0),
    debugLogging: getConfigValue('debugLogging', false),
  };
}

async function activate(context) {
  outputChannel = vscode.window.createOutputChannel('TokenLens');
  const config = readConfig();
  logger.initLogger(outputChannel, config.debugLogging);
  logger.log('activating', config);

  setGlobalStorageBase(context.globalStorageUri.fsPath);
  db = new Database(context.globalStorageUri.fsPath);

  // Status bar
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = COMMANDS.openPanel;
  statusBar.text = '$(telescope) TokenLens';
  statusBar.tooltip = 'Open TokenLens';
  statusBar.show();
  context.subscriptions.push(statusBar);

  // Init DB + first sync in the background.
  const initPromise = db.init().then(async () => {
    const cfg = readConfig();
    if (cfg.autoSyncOnStartup) await runSync();
    updateStatusBar();
    if (cfg.liveTracking) startWatcher();
  }).catch(err => {
    logger.warn('init failed', err.message);
    vscode.window.showErrorMessage('TokenLens init failed: ' + err.message);
  });

  // Commands
  const openPanelCommand = async () => {
    showPanel(context);
  };
  const refreshCommand = async () => {
    await initPromise;
    await runSync({ manual: true });
  };
  const exportCommand = async () => {
    await initPromise;
    await exportReportFlow();
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMANDS.openPanel, openPanelCommand),
    vscode.commands.registerCommand(COMMANDS.refresh, refreshCommand),
    vscode.commands.registerCommand(COMMANDS.export, exportCommand),
    vscode.commands.registerCommand(COMMANDS.legacyOpenPanel, openPanelCommand),
    vscode.commands.registerCommand(COMMANDS.legacyRefresh, refreshCommand),
    vscode.commands.registerCommand(COMMANDS.legacyExport, exportCommand)
  );

  // Sidebar view -> opens the full panel.
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEWS.panel, {
      resolveWebviewView(view) {
        view.webview.options = { enableScripts: true };
        view.webview.html = sidebarHtml();
        view.webview.onDidReceiveMessage(() => vscode.commands.executeCommand(COMMANDS.openPanel));
      }
    })
  );

  // React to config changes (live tracking toggle, debug, etc.).
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (!e.affectsConfiguration(CONFIG_NS) && !e.affectsConfiguration(LEGACY_CONFIG_NS)) return;
      const cfg = readConfig();
      logger.setDebug(cfg.debugLogging);
      if (cfg.liveTracking) startWatcher(); else stopWatcher();
    })
  );

  context.subscriptions.push({ dispose: () => { stopWatcher(); if (db) db.close(); } });
}

async function runSync({ manual = false } = {}) {
  if (!db || syncing) return;
  syncing = true;
  if (rpc) rpc.notify('syncStart');
  try {
    const cfg = readConfig();
    const result = await fullSync(db, cfg);
    // Budget alerts
    for (const a of checkBudgets(db, cfg)) {
      vscode.window.showWarningMessage(
        `TokenLens: ${a.period === 'day' ? 'daily' : 'weekly'} budget of ${formatUSD(a.limit)} reached (${formatUSD(a.spent)} so far).`
      );
    }
    updateStatusBar();
    if (rpc) rpc.notify('syncComplete', result);
    if (manual) {
      vscode.window.showInformationMessage(
        result.synced > 0 ? `TokenLens — synced ${result.synced} session${result.synced === 1 ? '' : 's'}` : 'TokenLens — up to date'
      );
    }
  } catch (err) {
    logger.warn('sync failed', err.message);
    if (manual) vscode.window.showErrorMessage('Sync failed: ' + err.message);
  } finally {
    syncing = false;
  }
}

function updateStatusBar() {
  if (!statusBar || !db) return;
  try {
    const b = getBudgetStatus(db, readConfig());
    statusBar.text = `$(telescope) ${formatTokens(b.day.tokens)} tok · ${formatUSD(b.day.usd)} today`;
    const overDay = b.day.limit > 0 && b.day.usd >= b.day.limit;
    statusBar.backgroundColor = overDay ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
    statusBar.tooltip = `TokenLens — today ${formatUSD(b.day.usd)}, this week ${formatUSD(b.week.usd)} (Claude Code shown as API-equivalent estimate). Click to open.`;
  } catch { /* ignore */ }
}

function startWatcher() {
  if (!watcher) watcher = new Watcher(() => runSync());
  watcher.start(readConfig());
}
function stopWatcher() { if (watcher) watcher.stop(); }

async function exportReportFlow(format) {
  if (!format) {
    const pick = await vscode.window.showQuickPick(['CSV', 'JSON'], { placeHolder: 'Export format' });
    if (!pick) return;
    format = pick.toLowerCase();
  }
  const out = buildExport(db, { format });
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(require('os').homedir(), out.filename)),
    filters: format === 'csv' ? { CSV: ['csv'] } : { JSON: ['json'] },
  });
  if (!uri) return;
  fs.writeFileSync(uri.fsPath, out.data, 'utf-8');
  vscode.window.showInformationMessage('TokenLens — exported to ' + uri.fsPath);
}

function showPanel(context) {
  if (panel) { panel.reveal(vscode.ViewColumn.One); return; }
  panel = vscode.window.createWebviewPanel(
    PANEL_VIEW_TYPE, 'TokenLens', vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'src', 'ui'))] }
  );
  panel.webview.html = panelHtml(panel.webview, context);
  rpc = createHostRpc(panel.webview);

  rpc.handle('getDashboard', ({ source, fromTs, toTs } = {}) => ({
    totals: queries.getTotals(db, { source, fromTs, toTs }),
    budget: getBudgetStatus(db, readConfig()),
    daily: queries.getDailySeries(db, { source, fromTs, toTs }),
    models: queries.getModelBreakdown(db, { source, fromTs, toTs }),
    latest: queries.getLatestSession(db, { source }),
    cache: queries.getCacheStats(db, { source, fromTs, toTs }),
    settings: { showEstimatedCost: readConfig()['showEstimatedCost'] },
    workspaceFolders: (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath),
  }));
  rpc.handle('getSessions', ({ source, fromTs, toTs } = {}) => queries.getSessions(db, { source, fromTs, toTs }));
  rpc.handle('getSessionModels', ({ sessionId } = {}) => queries.getSessionModels(db, sessionId));
  rpc.handle('openLog', async ({ path: p } = {}) => {
    if (!p || !fs.existsSync(p)) {
      if (p) vscode.window.showWarningMessage('TokenLens — log not found: ' + p);
      return { opened: false };
    }
    try {
      const sizeMB = fs.statSync(p).size / (1024 * 1024);
      if (sizeMB > 40) {
        // Editor can't load very large files via the extension host — reveal on disk instead.
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(p));
        vscode.window.showInformationMessage(`TokenLens — log is ${Math.round(sizeMB)} MB (too large for the editor); revealed in your file explorer.`);
        return { opened: true };
      }
      await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(p), { preview: true });
      return { opened: true };
    } catch (err) {
      try {
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(p));
        return { opened: true };
      } catch {
        vscode.window.showWarningMessage('TokenLens — could not open log: ' + (err && err.message));
        return { opened: false };
      }
    }
  });
  rpc.handle('triggerSync', async () => { await runSync({ manual: false }); return { ok: true }; });
  rpc.handle('export', async ({ format, source, fromTs, toTs } = {}) => { await exportReportFlowFromWebview(format, source, fromTs, toTs); return { ok: true }; });

  if (syncing) rpc.notify('syncStart');
  panel.onDidDispose(() => { if (rpc && rpc.dispose) rpc.dispose(); rpc = null; panel = null; });
}

async function exportReportFlowFromWebview(format, source, fromTs, toTs) {
  const fmt = (format || 'csv').toLowerCase();
  const out = buildExport(db, { format: fmt, source: source || undefined, fromTs, toTs });
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(require('os').homedir(), out.filename)),
    filters: fmt === 'csv' ? { CSV: ['csv'] } : { JSON: ['json'] },
  });
  if (!uri) return;
  fs.writeFileSync(uri.fsPath, out.data, 'utf-8');
  vscode.window.showInformationMessage('TokenLens — exported to ' + uri.fsPath);
}

function panelHtml(webview, context) {
  const uiDir = path.join(context.extensionPath, 'src', 'ui');
  const cssUri = webview.asWebviewUri(vscode.Uri.file(path.join(uiDir, 'styles.css')));
  const jsUri = webview.asWebviewUri(vscode.Uri.file(path.join(uiDir, 'app.js')));
  let html = fs.readFileSync(path.join(uiDir, 'index.html'), 'utf-8');
  html = html.replace('{{css}}', cssUri.toString())
             .replace('{{js}}', jsUri.toString())
             .replace(/\{\{cspSource\}\}/g, webview.cspSource);
  return html;
}

function sidebarHtml() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    body{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;padding:16px;text-align:center;font-family:var(--vscode-font-family);color:var(--vscode-foreground)}
    button{margin-top:10px;padding:6px 12px;cursor:pointer}
  </style></head><body>
    <h3>TokenLens</h3>
    <p>Claude Code, Copilot, and Gemini CLI token usage.</p>
    <button onclick="acquireVsCodeApi().postMessage('open')">Open Dashboard</button>
  </body></html>`;
}

function deactivate() {
  stopWatcher();
  if (db) { db.close(); db = null; }
}

module.exports = { activate, deactivate };
