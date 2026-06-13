/**
 * @fileoverview Cross-platform VS Code workspaceStorage path resolution for Copilot logs.
 */

const fs = require('fs');
const path = require('path');

let derivedBase = null;

/** Register the extension globalStorage path; lets us derive workspaceStorage in containers. */
function setGlobalStorageBase(globalStorageFsPath) {
  if (globalStorageFsPath) {
    derivedBase = path.join(path.dirname(path.dirname(globalStorageFsPath)), 'workspaceStorage');
  }
}

/** All existing VS Code workspaceStorage roots (Stable + Insiders, all OSes). */
function getWorkspaceStoragePaths() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const appdata = process.env.APPDATA;
  const candidates = [
    path.join(home, 'Library/Application Support/Code/User/workspaceStorage'),
    path.join(home, 'Library/Application Support/Code - Insiders/User/workspaceStorage'),
    ...(appdata ? [
      path.join(appdata, 'Code/User/workspaceStorage'),
      path.join(appdata, 'Code - Insiders/User/workspaceStorage'),
    ] : []),
    path.join(home, '.config/Code/User/workspaceStorage'),
    path.join(home, '.config/Code - Insiders/User/workspaceStorage'),
  ];
  const existing = candidates.filter(p => fs.existsSync(p));
  if (existing.length) return existing;
  if (derivedBase && fs.existsSync(derivedBase)) return [derivedBase];
  return [];
}

/** Decode a workspace.json folder/workspace URI to a filesystem path. */
function decodeWorkspacePath(raw) {
  if (!raw) return null;
  try {
    // decodeURIComponent turns %20 -> space, %3A -> ':' etc.
    const pathname = decodeURIComponent(new URL(raw).pathname);
    return pathname.replace(/^\/([A-Za-z]:)/, '$1') || null;
  } catch {
    try { return decodeURIComponent(raw.replace(/^file:\/\/\//, '/')) || null; }
    catch { return raw.replace(/^file:\/\/\//, '/') || null; }
  }
}

module.exports = { setGlobalStorageBase, getWorkspaceStoragePaths, decodeWorkspacePath };
