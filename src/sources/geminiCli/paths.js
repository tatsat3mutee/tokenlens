/**
 * @fileoverview Resolve the Gemini CLI session storage directory.
 *
 * Gemini CLI auto-saves every session under:
 *   ~/.gemini/tmp/<project_hash>/chats/session-<timestamp>-<shortid>.json|.jsonl
 *
 * Default home: ~/.gemini. Honors $GEMINI_CLI_HOME and an explicit override
 * (the tokenLens.geminiCliHome setting, passed in).
 */

const fs = require('fs');
const path = require('path');

/**
 * @param {string} [override] - tokenLens.geminiCliHome (a .gemini home dir), optional.
 * @returns {string|null} absolute path to the tmp dir (project hashes live under it), or null.
 */
function getGeminiTmpDir(override) {
  const home = override
    || process.env.GEMINI_CLI_HOME
    || path.join(process.env.USERPROFILE || process.env.HOME || '', '.gemini');
  if (!home) return null;
  // Allow the override to point either at the .gemini dir or directly at tmp/.
  if (path.basename(home) === 'tmp' && fs.existsSync(home)) return home;
  const tmp = path.join(home, 'tmp');
  return fs.existsSync(tmp) ? tmp : null;
}

module.exports = { getGeminiTmpDir };
