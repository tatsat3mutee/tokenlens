/**
 * @fileoverview Bundled pricing lookups (Claude Code, Gemini CLI). Returns base $/Mtok
 * per model, matched by family substring. Unknown models return null so the caller can
 * flag them.
 */

const table = require('../sources/claudeCode/pricing.json');
const geminiTable = require('../sources/geminiCli/pricing.json');

/**
 * @param {string} modelId e.g. "claude-opus-4-8", "claude-haiku-4-5-20251001"
 * @returns {{input:number, output:number, family:string}|null}
 */
function getClaudePricing(modelId) {
  if (!modelId) return null;
  const id = modelId.toLowerCase();
  const families = table.families;
  // Check most-specific first so "fable" isn't shadowed.
  for (const family of ['fable', 'opus', 'sonnet', 'haiku']) {
    if (id.includes(family) && families[family]) {
      return { ...families[family], family };
    }
  }
  return null;
}

/**
 * @param {string} modelId e.g. "gemini-2.5-pro", "gemini-2.5-flash-lite"
 * @returns {{input:number, output:number, cacheRead:number, cacheWrite:number, family:string}|null}
 */
function getGeminiPricing(modelId) {
  if (!modelId) return null;
  const id = modelId.toLowerCase();
  const families = geminiTable.families;
  // Most-specific first so "2.5-flash" doesn't shadow "2.5-flash-lite".
  for (const family of ['2.5-flash-lite', '2.5-flash', '2.5-pro', '2.0-flash-lite', '2.0-flash', '1.5-flash', '1.5-pro']) {
    if (id.includes(family) && families[family]) {
      return { ...families[family], family };
    }
  }
  return null;
}

module.exports = { getClaudePricing, getGeminiPricing };
