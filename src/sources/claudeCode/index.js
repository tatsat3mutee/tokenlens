/**
 * @fileoverview Claude Code source: discover session transcripts and parse usage.
 *
 * Layout:
 *   ~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl          (main transcript)
 *   ~/.claude/projects/<encoded-cwd>/<session-uuid>/subagents/agent-*.jsonl  (sub-agents)
 *
 * Each assistant line carries message.usage:
 *   input_tokens (fresh, EXCLUDES cache), cache_read_input_tokens,
 *   cache_creation_input_tokens, output_tokens. Plus message.model, timestamp, cwd.
 */

const fs = require('fs');
const path = require('path');
const { getClaudeProjectsDir } = require('./paths');

const SOURCE = 'claudeCode';

/**
 * Discover Claude Code sessions. One descriptor per <uuid>.jsonl, with any
 * sub-agent files attached so they sync together.
 * @param {string} [override] tokenLens.claudeCodeHome
 */
function discover(override) {
  const projectsDir = getClaudeProjectsDir(override);
  if (!projectsDir) return [];

  const out = [];
  let projects;
  try {
    projects = fs.readdirSync(projectsDir, { withFileTypes: true }).filter(d => d.isDirectory());
  } catch {
    return out;
  }

  for (const proj of projects) {
    const projDir = path.join(projectsDir, proj.name);
    let entries;
    try { entries = fs.readdirSync(projDir, { withFileTypes: true }); } catch { continue; }

    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
      const uuid = e.name.slice(0, -'.jsonl'.length);
      const mainPath = path.join(projDir, e.name);
      const subDir = path.join(projDir, uuid, 'subagents');
      const subFiles = [];
      try {
        if (fs.existsSync(subDir)) {
          for (const s of fs.readdirSync(subDir)) {
            if (s.endsWith('.jsonl')) subFiles.push(path.join(subDir, s));
          }
        }
      } catch { /* ignore */ }

      out.push({
        source: SOURCE,
        sessionId: 'cc:' + uuid,
        sourcePath: mainPath,
        subFiles,
        projectDirName: proj.name,
      });
    }
  }
  return out;
}

/**
 * Parse a Claude Code session (main file + sub-agent files) into normalized calls.
 * @param {string} mainPath
 * @param {string[]} [subFiles]
 * @returns {{title:string|null, workspace:string|null, calls:Array, models:string[], firstTs:number|null, lastTs:number|null}}
 */
function parse(mainPath, subFiles = []) {
  const result = { title: null, workspace: null, calls: [], models: [], firstTs: null, lastTs: null };
  const models = new Set();
  const seen = new Set(); // dedupe assistant messages by message.id

  parseFile(mainPath, false, result, models, seen);
  for (const sf of subFiles) parseFile(sf, true, result, models, seen);

  result.models = [...models];
  return result;
}

function parseFile(filePath, isSubagentFile, result, models, seen) {
  let content;
  try { content = fs.readFileSync(filePath, 'utf-8'); } catch { return; }

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }

    if (!result.workspace && ev.cwd) result.workspace = ev.cwd;

    // Title: first user prompt, else a summary line.
    if (!result.title) {
      if (ev.type === 'user') {
        const t = extractUserText(ev.message && ev.message.content);
        if (t) result.title = t;
      } else if (ev.type === 'summary' && ev.summary) {
        result.title = String(ev.summary).slice(0, 200);
      }
    }

    if (ev.type !== 'assistant' || !ev.message || !ev.message.usage) continue;
    const msg = ev.message;
    const id = msg.id || ev.uuid;
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);

    const u = msg.usage;
    const model = msg.model || 'unknown';
    models.add(model);
    const tsSec = ev.timestamp ? Math.floor(Date.parse(ev.timestamp) / 1000) : null;

    result.calls.push({
      ts: tsSec,
      model,
      inputFresh: u.input_tokens || 0,
      cacheRead: u.cache_read_input_tokens || 0,
      cacheWrite: u.cache_creation_input_tokens || 0,
      output: u.output_tokens || 0,
      isSubagent: isSubagentFile || ev.isSidechain === true,
    });

    if (tsSec != null) {
      if (result.firstTs == null || tsSec < result.firstTs) result.firstTs = tsSec;
      if (result.lastTs == null || tsSec > result.lastTs) result.lastTs = tsSec;
    }
  }
}

/** User message content can be a string or an array of blocks. */
function extractUserText(content) {
  if (!content) return null;
  if (typeof content === 'string') return cleanPrompt(content);
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && block.type === 'text' && typeof block.text === 'string') {
        const t = cleanPrompt(block.text);
        if (t) return t;
      }
    }
  }
  return null;
}

/**
 * Return a human prompt title, or null for harness-injected wrappers
 * (system reminders, command output, IDE/selection notices) so the title
 * reflects what the user actually typed.
 */
function cleanPrompt(text) {
  const t = (text || '').trim();
  if (!t) return null;
  if (/^<(local-command|command-|ide_|system-reminder|user-prompt-submit|caveat)/i.test(t)) return null;
  return t.slice(0, 200);
}

module.exports = { discover, parse, SOURCE };
