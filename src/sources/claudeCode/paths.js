/**
 * @fileoverview Resolve the Claude Code projects directory.
 *
 * Default: ~/.claude/projects. Honors $CLAUDE_CONFIG_DIR and an explicit override
 * (the tokenLens.claudeCodeHome setting, passed in).
 */

const fs = require('fs');
const path = require('path');

/**
 * @param {string} [override] - tokenLens.claudeCodeHome (a .claude home dir), optional.
 * @returns {string|null} absolute path to the projects dir, or null if absent.
 */
function getClaudeProjectsDir(override) {
  const home = override
    || process.env.CLAUDE_CONFIG_DIR
    || path.join(process.env.USERPROFILE || process.env.HOME || '', '.claude');
  if (!home) return null;
  // Allow the override to point either at the .claude dir or directly at projects/.
  const candidates = [path.join(home, 'projects'), home];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isDirectory() && path.basename(c) === 'projects') return c;
  }
  const projects = path.join(home, 'projects');
  return fs.existsSync(projects) ? projects : null;
}

module.exports = { getClaudeProjectsDir };
