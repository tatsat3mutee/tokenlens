/**
 * @fileoverview Minimal postMessage RPC bridge (extension host <-> webview).
 *
 * Promise-based request/response plus one-way notifications. No HTTP server.
 */

const RPC_REQUEST = 'rpc:request';
const RPC_RESPONSE = 'rpc:response';
const RPC_NOTIFICATION = 'rpc:notification';
const DEFAULT_TIMEOUT = 30000;

let _nextId = 1;

/** Extension-host side: register handlers, push notifications. */
function createHostRpc(webview) {
  const handlers = new Map();
  const disposable = webview.onDidReceiveMessage(async (message) => {
    if (!message || message.type !== RPC_REQUEST) return;
    const { id, method, params } = message;
    const handler = handlers.get(method);
    if (!handler) {
      webview.postMessage({ type: RPC_RESPONSE, id, error: { message: `Unknown method: ${method}` } });
      return;
    }
    try {
      const result = await handler(params || {});
      webview.postMessage({ type: RPC_RESPONSE, id, result });
    } catch (err) {
      webview.postMessage({ type: RPC_RESPONSE, id, error: { message: err.message || String(err) } });
    }
  });

  return {
    handle: (method, fn) => handlers.set(method, fn),
    notify: (event, data) => webview.postMessage({ type: RPC_NOTIFICATION, event, data }),
    dispose: () => { if (disposable && disposable.dispose) disposable.dispose(); handlers.clear(); }
  };
}

/** Webview side: call() returns a Promise; on() subscribes to notifications. */
function createWebviewRpc(vscodeApi, options = {}) {
  const timeout = options.timeout || DEFAULT_TIMEOUT;
  const pending = new Map();
  const listeners = new Map();

  function handleMessage(event) {
    const message = event.data;
    if (!message) return;
    if (message.type === RPC_RESPONSE) {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
    } else if (message.type === RPC_NOTIFICATION) {
      const cbs = listeners.get(message.event);
      if (cbs) for (const cb of cbs) { try { cb(message.data); } catch { /* ignore */ } }
    }
  }

  if (typeof window !== 'undefined') window.addEventListener('message', handleMessage);

  return {
    call(method, params) {
      return new Promise((resolve, reject) => {
        const id = `rpc:${_nextId++}`;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`RPC timeout: ${method}`)); }, timeout);
        pending.set(id, { resolve, reject, timer });
        vscodeApi.postMessage({ type: RPC_REQUEST, id, method, params });
      });
    },
    on(event, cb) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(cb);
    }
  };
}

module.exports = { createHostRpc, createWebviewRpc, RPC_REQUEST, RPC_RESPONSE, RPC_NOTIFICATION };
