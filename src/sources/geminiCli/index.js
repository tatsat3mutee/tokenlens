/**
 * @fileoverview Gemini CLI source: discover auto-saved session files and parse usage.
 *
 * Layout:
 *   ~/.gemini/tmp/<project_hash>/chats/session-<ts>-<shortid>.json    (legacy, pretty JSON)
 *   ~/.gemini/tmp/<project_hash>/chats/session-<ts>-<shortid>.jsonl   (current: line 1 =
 *     metadata {sessionId, projectHash, startTime, lastUpdated, kind?}, then one message per line)
 *   ~/.gemini/tmp/<project_hash>/.project_root                        (workspace path)
 *
 * Subagent sessions carry kind:"subagent" and share the parent's 8-char short id in the
 * filename (or live in a chats/<parent-session-id>/ subdirectory).
 *
 * Message records: { id, timestamp, type:'user'|'gemini'|'info'|..., content, model?,
 *   tokens?: { input, output, cached, thoughts, tool, total } }.
 * tokens.input is the FULL prompt (includes cached); fresh input = input - cached + tool.
 * Gemini CLI does not record cost, so USD is always estimated from the bundled price table.
 */

const fs = require('fs');
const path = require('path');
const { getGeminiTmpDir } = require('./paths');

const SOURCE = 'geminiCli';
const FILE_RE = /^session-.*-([0-9a-zA-Z]{4,12})\.(json|jsonl)$/;

/**
 * Read the head of a session file and extract metadata without parsing the
 * whole document (legacy .json files can be large). Both formats put
 * sessionId/kind in the first ~200 bytes.
 * @returns {{sessionId:string|null, kind:string|null}}
 */
function peekMeta(filePath) {
  let head = '';
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(2048);
    const n = fs.readSync(fd, buf, 0, 2048, 0);
    fs.closeSync(fd);
    head = buf.toString('utf-8', 0, n);
  } catch {
    return { sessionId: null, kind: null };
  }
  const sid = /"sessionId"\s*:\s*"([^"]+)"/.exec(head);
  const kind = /"kind"\s*:\s*"([^"]+)"/.exec(head);
  return { sessionId: sid ? sid[1] : null, kind: kind ? kind[1] : null };
}

/** Read the workspace path recorded for a project hash, if present. */
function readProjectRoot(hashDir) {
  try {
    const p = fs.readFileSync(path.join(hashDir, '.project_root'), 'utf-8').trim();
    return p || null;
  } catch {
    return null;
  }
}

/**
 * Discover Gemini CLI sessions. Main sessions and their subagent files (matched
 * by shared short id or chats/<session-id>/ subdirectory) sync together.
 * @param {string} [override] tokenLens.geminiCliHome
 */
function discover(override) {
  const tmpDir = getGeminiTmpDir(override);
  if (!tmpDir) return [];

  const out = [];
  let hashes;
  try {
    hashes = fs.readdirSync(tmpDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return out;
  }

  for (const h of hashes) {
    const hashDir = path.join(tmpDir, h.name);
    const chatsDir = path.join(hashDir, 'chats');
    let entries;
    try { entries = fs.readdirSync(chatsDir, { withFileTypes: true }); } catch { continue; }

    const workspace = readProjectRoot(hashDir);
    /** @type {Map<string, {main:{file:string, sessionId:string|null}|null, subs:string[]}>} */
    const groups = new Map();
    const subdirsBySession = new Map(); // sessionId -> [subagent files]

    for (const e of entries) {
      if (e.isDirectory()) {
        // chats/<parent-session-id>/ holds subagent transcripts.
        const subFiles = [];
        try {
          for (const s of fs.readdirSync(path.join(chatsDir, e.name))) {
            if (/\.(json|jsonl)$/.test(s)) subFiles.push(path.join(chatsDir, e.name, s));
          }
        } catch { /* ignore */ }
        if (subFiles.length) subdirsBySession.set(e.name, subFiles);
        continue;
      }
      const m = FILE_RE.exec(e.name);
      if (!m) continue;
      const shortId = m[1];
      const filePath = path.join(chatsDir, e.name);
      const meta = peekMeta(filePath);
      if (!groups.has(shortId)) groups.set(shortId, { main: null, subs: [] });
      const g = groups.get(shortId);
      if (meta.kind === 'subagent') g.subs.push(filePath);
      else if (!g.main) g.main = { file: filePath, sessionId: meta.sessionId };
      else g.subs.push(filePath); // defensive: extra "main" with same short id
    }

    for (const [shortId, g] of groups) {
      if (!g.main) continue; // orphaned subagent files
      const sid = g.main.sessionId || `${h.name.slice(0, 8)}-${shortId}`;
      const subFiles = [...g.subs, ...(subdirsBySession.get(g.main.sessionId) || [])];
      out.push({
        source: SOURCE,
        sessionId: 'gm:' + sid,
        sourcePath: g.main.file,
        subFiles,
        workspace,
      });
    }
  }
  return out;
}

/**
 * Parse a Gemini CLI session (main + subagent files) into normalized calls.
 * @param {string} mainPath
 * @param {string[]} [subFiles]
 * @returns {{title:string|null, workspace:string|null, calls:Array, models:string[], firstTs:number|null, lastTs:number|null}}
 */
function parse(mainPath, subFiles = []) {
  const result = { title: null, workspace: null, calls: [], models: [], firstTs: null, lastTs: null };
  const models = new Set();

  parseFile(mainPath, false, result, models);
  for (const sf of subFiles) parseFile(sf, true, result, models);

  result.models = [...models];
  return result;
}

function parseFile(filePath, isSubagentFile, result, models) {
  let content;
  try { content = fs.readFileSync(filePath, 'utf-8'); } catch { return; }

  const messages = extractMessages(content, result);
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    const tsSec = msg.timestamp ? Math.floor(Date.parse(msg.timestamp) / 1000) : null;
    if (tsSec != null && !Number.isNaN(tsSec)) {
      if (result.firstTs == null || tsSec < result.firstTs) result.firstTs = tsSec;
      if (result.lastTs == null || tsSec > result.lastTs) result.lastTs = tsSec;
    }

    if (!result.title && msg.type === 'user' && !isSubagentFile) {
      const t = extractText(msg.content);
      if (t) result.title = t;
    }

    if (msg.type !== 'gemini' || !msg.tokens) continue;
    const tk = msg.tokens;
    const model = msg.model || 'unknown';
    models.add(model);

    const cached = tk.cached || 0;
    // tokens.input is the full prompt incl. cached reads; tool-use prompt tokens are extra fresh input.
    const inputFresh = Math.max(0, (tk.input || 0) - cached) + (tk.tool || 0);

    result.calls.push({
      ts: Number.isNaN(tsSec) ? null : tsSec,
      model,
      inputFresh,
      cacheRead: cached,
      cacheWrite: 0, // implicit caching: no separate cache-write tokens or fee
      output: (tk.output || 0) + (tk.thoughts || 0), // thinking tokens billed as output
      isSubagent: isSubagentFile,
    });
  }
}

/**
 * Session files come in two shapes:
 *  - legacy .json: one pretty-printed object { sessionId, startTime, ..., messages: [...] }
 *  - .jsonl: metadata object on line 1, then one message object per line
 */
function extractMessages(content, result) {
  const trimmed = content.trimStart();
  const firstNl = content.indexOf('\n');
  const firstLine = firstNl === -1 ? content : content.slice(0, firstNl);

  // Try JSONL first: line 1 parses on its own and has no messages array.
  let metaLine = null;
  try { metaLine = JSON.parse(firstLine); } catch { /* not JSONL */ }
  if (metaLine && typeof metaLine === 'object' && !Array.isArray(metaLine.messages)) {
    applyMetaTs(metaLine, result);
    const messages = [];
    for (const line of content.split('\n').slice(1)) {
      if (!line.trim()) continue;
      try { messages.push(JSON.parse(line)); } catch { /* skip bad line */ }
    }
    return messages;
  }

  // Legacy single-document JSON.
  try {
    const doc = JSON.parse(trimmed);
    applyMetaTs(doc, result);
    return Array.isArray(doc.messages) ? doc.messages : [];
  } catch {
    return [];
  }
}

/** Seed first/last timestamps from session metadata (messages may lack timestamps). */
function applyMetaTs(meta, result) {
  for (const [key, cmp] of [['startTime', 'firstTs'], ['lastUpdated', 'lastTs']]) {
    if (!meta[key]) continue;
    const sec = Math.floor(Date.parse(meta[key]) / 1000);
    if (Number.isNaN(sec)) continue;
    if (result[cmp] == null) result[cmp] = sec;
  }
}

/** Message content can be a string or an array of part objects with .text. */
function extractText(content) {
  if (typeof content === 'string') return clean(content);
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part && typeof part.text === 'string') {
        const t = clean(part.text);
        if (t) return t;
      }
    }
  }
  return null;
}

function clean(text) {
  const t = (text || '').trim();
  if (!t) return null;
  if (/^<(session_context|hook_context)/i.test(t)) return null; // injected context, not the user
  return t.slice(0, 200);
}

module.exports = { discover, parse, SOURCE };
