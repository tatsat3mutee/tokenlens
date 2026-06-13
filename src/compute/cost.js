/**
 * @fileoverview Source-agnostic per-call cost computation.
 *
 * A normalized call is { inputFresh, cacheRead, cacheWrite, output } (token counts).
 * A pricing record is { input, output, cacheRead?, cacheWrite? } in USD per 1M tokens.
 * When cacheRead/cacheWrite rates are omitted they default to Anthropic's standard
 * multipliers (read = 0.1x input, write = 1.25x input for 5m / 2x for 1h).
 */

/**
 * @param {{inputFresh:number, cacheRead:number, cacheWrite:number, output:number}} call
 * @param {{input:number, output:number, cacheRead?:number, cacheWrite?:number}} pricing
 * @param {{cacheWriteTtl?:'5m'|'1h'}} [opts]
 * @returns {number} cost in USD
 */
function computeCallCost(call, pricing, opts = {}) {
  if (!pricing) return 0;
  const inputRate = pricing.input || 0;
  const outputRate = pricing.output || 0;
  const readRate = pricing.cacheRead != null ? pricing.cacheRead : inputRate * 0.1;
  const writeMult = opts.cacheWriteTtl === '1h' ? 2 : 1.25;
  const writeRate = pricing.cacheWrite != null ? pricing.cacheWrite : inputRate * writeMult;

  const cost =
    (call.inputFresh || 0) * inputRate +
    (call.cacheRead || 0) * readRate +
    (call.cacheWrite || 0) * writeRate +
    (call.output || 0) * outputRate;

  return cost / 1e6;
}

module.exports = { computeCallCost };
