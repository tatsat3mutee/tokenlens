/**
 * @fileoverview Live tracking: watch both log roots and debounce a re-sync on change.
 *
 * fs.watch with { recursive: true } is supported on Windows and macOS (the two
 * platforms VS Code desktop runs Claude Code / Copilot on). On Linux it may not
 * recurse; we degrade gracefully (startup + manual sync still work).
 */

const fs = require('fs');
const { getWorkspaceStoragePaths } = require('../sources/copilot/paths');
const { getClaudeProjectsDir } = require('../sources/claudeCode/paths');
const { getGeminiTmpDir } = require('../sources/geminiCli/paths');
const log = require('../utils/logger');

class Watcher {
  /** @param {() => void} onChange debounced callback */
  constructor(onChange, debounceMs = 1500) {
    this.onChange = onChange;
    this.debounceMs = debounceMs;
    this.watchers = [];
    this.timer = null;
  }

  start(config) {
    this.stop();
    const sources = config.sources || ['claudeCode', 'copilot', 'geminiCli'];
    /** @type {Array<{root:string, match:RegExp}>} */
    const roots = [];
    const jsonl = /\.jsonl$/;
    if (sources.includes('copilot')) {
      for (const r of getWorkspaceStoragePaths()) roots.push({ root: r, match: jsonl });
    }
    if (sources.includes('claudeCode')) {
      const cc = getClaudeProjectsDir(config.claudeCodeHome);
      if (cc) roots.push({ root: cc, match: jsonl });
    }
    if (sources.includes('geminiCli')) {
      const gm = getGeminiTmpDir(config.geminiCliHome);
      // Only session files under chats/ — the tmp dir also holds otel logs etc.
      if (gm) roots.push({ root: gm, match: /(^|[\\/])chats[\\/].*\.jsonl?$/ });
    }

    for (const { root, match } of roots) {
      try {
        const w = fs.watch(root, { recursive: true }, (_evt, filename) => {
          if (filename && match.test(String(filename))) this._schedule();
        });
        this.watchers.push(w);
        log.log('watching', root);
      } catch (err) {
        log.warn('watch failed for', root, err.message);
      }
    }
  }

  _schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.onChange(); }, this.debounceMs);
  }

  stop() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    for (const w of this.watchers) { try { w.close(); } catch { /* ignore */ } }
    this.watchers = [];
  }
}

module.exports = { Watcher };
