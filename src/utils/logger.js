/**
 * @fileoverview Tiny output-channel logger. Gated by tokenLens.debugLogging.
 */

let channel = null;
let debugEnabled = false;

function initLogger(outputChannel, debug) {
  channel = outputChannel;
  debugEnabled = !!debug;
}

function setDebug(v) { debugEnabled = !!v; }

function log(...args) {
  if (!debugEnabled) return;
  const line = `[${new Date().toISOString()}] ${args.map(stringify).join(' ')}`;
  if (channel) channel.appendLine(line);
  else console.log(line);
}

function warn(...args) {
  const line = `[warn] ${args.map(stringify).join(' ')}`;
  if (channel) channel.appendLine(line);
  else console.warn(line);
}

function stringify(a) {
  return typeof a === 'string' ? a : JSON.stringify(a);
}

module.exports = { initLogger, setDebug, log, warn };
