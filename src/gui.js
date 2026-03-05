#!/usr/bin/env node
/**
 * Claude Workspace Manager - GUI Entry Point
 *
 * Starts the Express web server and opens the browser.
 * Use --demo to seed sample workspaces and sessions on first run.
 *
 * Usage:
 *   node src/gui.js           Launch the web GUI
 *   node src/gui.js --demo    Launch with demo data (if store is empty)
 *
 * Environment:
 *   PORT=3456                 Override the default port
 */

const fs = require('fs');
const path = require('path');
const { getStore } = require('./state/store');
const { startServer, getPtyManager } = require('./web/server');
const { backupFrontend } = require('./web/backup');

// ─── PID File ──────────────────────────────────────────────
// Kill any previous server instance before starting, so closing the
// terminal window (which orphans gui.js on Windows) doesn't leave a
// stale process holding the port.

const PID_FILE = path.join(__dirname, '..', 'state', 'server.pid');

function killStalePid() {
  try {
    if (!fs.existsSync(PID_FILE)) return;
    const oldPid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    if (!oldPid || oldPid === process.pid) return;
    try {
      process.kill(oldPid, 0); // throws if process doesn't exist
      process.kill(oldPid);    // SIGTERM
      console.log(`[PID] Killed stale server process ${oldPid}`);
      // Give it a moment to release the port
      const deadline = Date.now() + 2000;
      const sleep = new Int32Array(new SharedArrayBuffer(4));
      while (Date.now() < deadline) {
        try { process.kill(oldPid, 0); } catch { break; }
        Atomics.wait(sleep, 0, 0, 100);
      }
    } catch (_) { /* already gone */ }
  } catch (_) {}
}

function writePid() {
  try {
    fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
    fs.writeFileSync(PID_FILE, String(process.pid));
  } catch (_) {}
}

function removePid() {
  try { fs.unlinkSync(PID_FILE); } catch (_) {}
}

killStalePid();
writePid();

// ─── Initialize Store ──────────────────────────────────────

const store = getStore();

// ─── Demo Data Seeding ─────────────────────────────────────

if (process.argv.includes('--demo')) {
  // Only seed if there are no existing workspaces
  if (store.getAllWorkspacesList().length === 0) {
    const ws1 = store.createWorkspace({
      name: 'Project Alpha',
      description: 'Frontend application',
    });
    const ws2 = store.createWorkspace({
      name: 'Backend API',
      description: 'Backend services',
    });
    const ws3 = store.createWorkspace({
      name: 'Documentation',
      description: 'Docs & guides',
    });

    // Use platform-appropriate demo paths (PTY manager validates and falls back to homedir)
    const path = require('path');
    const home = require('os').homedir();
    const demoBase = path.join(home, 'Projects');

    store.createSession({
      name: 'ui-components',
      workspaceId: ws1.id,
      workingDir: path.join(demoBase, 'project-alpha'),
      topic: 'React components',
    });
    store.createSession({
      name: 'state-mgmt',
      workspaceId: ws1.id,
      workingDir: path.join(demoBase, 'project-alpha', 'state'),
      topic: 'State management',
    });
    store.createSession({
      name: 'api-routes',
      workspaceId: ws2.id,
      workingDir: path.join(demoBase, 'backend-api'),
      topic: 'REST endpoints',
    });
    store.createSession({
      name: 'db-migrations',
      workspaceId: ws2.id,
      workingDir: path.join(demoBase, 'backend-api', 'db'),
      topic: 'Database schema',
    });
    store.createSession({
      name: 'readme-update',
      workspaceId: ws3.id,
      workingDir: path.join(demoBase, 'docs'),
      topic: 'README overhaul',
    });
    store.createSession({
      name: 'api-docs',
      workspaceId: ws3.id,
      workingDir: path.join(demoBase, 'docs', 'api'),
      topic: 'API reference',
    });

    store.save();
    console.log('Demo data seeded.');
  }
}

// ─── Start Server ──────────────────────────────────────────

const port = parseInt(process.env.PORT, 10) || 3456;
const host = process.env.CWM_HOST || '127.0.0.1';
const server = startServer(port, host);

console.log(`CWM GUI running at http://${host}:${port}`);
console.log('Press Ctrl+C to stop.');

// Snapshot frontend files as "last known good" on successful start
backupFrontend();

// ─── Open Browser ────────────────────────────────────────────
// Skip auto-open when running headless (e.g., marketing capture pipeline)
// --cdp flag launches browser with Chrome DevTools Protocol remote debugging
// so the visual-qa MCP server can screenshot and inspect the UI.

/**
 * Open a URL in the default browser, cross-platform.
 * Windows: 'start', macOS: 'open', Linux/WSL: 'xdg-open'.
 * @param {string} url - The URL to open
 * @param {Function} [callback] - Optional error callback
 */
function openBrowser(url, callback) {
  const { exec } = require('child_process');
  const platform = process.platform;
  let cmd;
  if (platform === 'win32') {
    cmd = `start "" "${url}"`;
  } else if (platform === 'darwin') {
    cmd = `open "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }
  exec(cmd, (err) => {
    if (err && callback) callback(err);
    else if (err) console.log(`Could not auto-open browser. Visit ${url} manually.`);
  });
}

/**
 * Launch a browser in app mode (no address bar, no tabs) — feels like a native desktop app.
 * Tries Chrome first, then Edge (Windows) / Chromium (Linux), then falls back to default browser.
 * @param {string} url - The URL to open
 */
function openBrowserAppMode(url) {
  const { exec } = require('child_process');
  const platform = process.platform;

  const attempts = [];
  if (platform === 'win32') {
    attempts.push(`start "" chrome --app="${url}"`);
    attempts.push(`start "" msedge --app="${url}"`);
  } else if (platform === 'darwin') {
    attempts.push(`open -a "Google Chrome" --args --app="${url}"`);
    attempts.push(`open -a "Chromium" --args --app="${url}"`);
  } else {
    attempts.push(`google-chrome --app="${url}"`);
    attempts.push(`chromium-browser --app="${url}"`);
    attempts.push(`chromium --app="${url}"`);
  }

  function tryNext(index) {
    if (index >= attempts.length) {
      console.log(`Could not launch browser in app mode. Falling back to default browser.`);
      openBrowser(url);
      return;
    }
    exec(attempts[index], (err) => {
      if (err) tryNext(index + 1);
    });
  }
  tryNext(0);
}

/**
 * Launch a specific browser with CDP remote debugging enabled, cross-platform.
 * Tries Chrome first, then Edge (Windows) / Chromium (Linux), then falls back to default browser.
 * @param {string} url - The URL to open
 * @param {number} cdpPort - Chrome DevTools Protocol debugging port
 */
function openBrowserWithCDP(url, cdpPort) {
  const { exec } = require('child_process');
  const platform = process.platform;

  // Platform-specific browser launch commands for CDP
  const attempts = [];
  if (platform === 'win32') {
    attempts.push(`start "" chrome --remote-debugging-port=${cdpPort} "${url}"`);
    attempts.push(`start "" msedge --remote-debugging-port=${cdpPort} "${url}"`);
  } else if (platform === 'darwin') {
    attempts.push(`open -a "Google Chrome" "${url}" --args --remote-debugging-port=${cdpPort}`);
    attempts.push(`open -a "Chromium" "${url}" --args --remote-debugging-port=${cdpPort}`);
  } else {
    attempts.push(`google-chrome --remote-debugging-port=${cdpPort} "${url}"`);
    attempts.push(`chromium-browser --remote-debugging-port=${cdpPort} "${url}"`);
    attempts.push(`chromium --remote-debugging-port=${cdpPort} "${url}"`);
  }

  // Try each in sequence, fall back to default browser if all fail
  function tryNext(index) {
    if (index >= attempts.length) {
      console.log(`Could not launch browser with CDP. Open manually with --remote-debugging-port=${cdpPort}`);
      openBrowser(url);
      return;
    }
    exec(attempts[index], (err) => {
      if (err) tryNext(index + 1);
    });
  }
  tryNext(0);
}

if (!process.env.CWM_NO_OPEN) {
  const cdpEnabled = process.argv.includes('--cdp');
  const appMode = process.argv.includes('--app');
  const cdpPort = parseInt(process.env.CDP_PORT, 10) || 9222;
  const url = `http://localhost:${port}`;

  if (cdpEnabled) {
    openBrowserWithCDP(url, cdpPort);
    console.log(`CDP remote debugging enabled on port ${cdpPort}`);
    console.log(`Visual QA MCP can connect at localhost:${cdpPort}`);
  } else if (appMode) {
    openBrowserAppMode(url);
  } else {
    openBrowser(url);
  }
}

// ─── Graceful Shutdown ─────────────────────────────────────

process.on('SIGINT', () => {
  removePid();
  const ptyManager = getPtyManager();
  if (ptyManager) ptyManager.destroyAll();
  store.save();
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  removePid();
  const ptyManager = getPtyManager();
  if (ptyManager) ptyManager.destroyAll();
  store.save();
  server.close();
  process.exit(0);
});
