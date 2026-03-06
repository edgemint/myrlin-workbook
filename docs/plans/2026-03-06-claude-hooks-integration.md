# Claude Code Hooks Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add HTTP hook endpoints to the existing Express server so Claude Code can POST lifecycle events to CWM, and provide an install script that wires up ~/.claude/settings.json automatically.

**Architecture:** A new Express Router (`src/web/hooks-router.js`) handles all six Claude Code hook events as unauthenticated POST endpoints. It is mounted into the existing server at `/hooks/*`. A separate Node.js install script (`scripts/install-hooks.js`) reads/merges/writes `~/.claude/settings.json` idempotently.

**Tech Stack:** Node.js, Express Router, fs/path (stdlib only for install script)

---

## Claude Code Hook Events Reference

All six events and their known payload shapes:

| Event | URL slug | Key payload fields |
|---|---|---|
| `SessionStart` | `/hooks/session-start` | `session_id`, `cwd`, `timestamp` |
| `PreToolUse` | `/hooks/pre-tool-use` | `session_id`, `tool_name`, `tool_input` |
| `PostToolUse` | `/hooks/post-tool-use` | `session_id`, `tool_name`, `tool_input`, `tool_response` |
| `Notification` | `/hooks/notification` | `session_id`, `message` |
| `Stop` | `/hooks/stop` | `session_id`, `stop_reason`, `cost_usd` |
| `SubagentStop` | `/hooks/subagent-stop` | `session_id`, `stop_reason` |

Hook payloads arrive as JSON POST bodies. Claude Code expects a 200 response; non-200 causes a hook failure warning in the session.

---

### Task 1: Create the hooks router

**Files:**
- Create: `src/web/hooks-router.js`

**Step 1: Create the file**

```js
/**
 * Express Router for Claude Code HTTP hook endpoints.
 *
 * Claude Code calls these URLs on lifecycle events (SessionStart,
 * PreToolUse, PostToolUse, Notification, Stop, SubagentStop).
 * No auth required — these are localhost-only calls from Claude Code.
 *
 * Mount with: app.use('/hooks', hooksRouter);
 */

'use strict';

const { Router } = require('express');

const router = Router();

// ANSI color helpers for readable console output
const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  cyan:    '\x1b[36m',
  yellow:  '\x1b[33m',
  green:   '\x1b[32m',
  magenta: '\x1b[35m',
  red:     '\x1b[31m',
  blue:    '\x1b[34m',
  gray:    '\x1b[90m',
};

const EVENT_COLORS = {
  'session-start':  C.green,
  'pre-tool-use':   C.yellow,
  'post-tool-use':  C.cyan,
  'notification':   C.blue,
  'stop':           C.magenta,
  'subagent-stop':  C.red,
};

/**
 * Pretty-print a hook payload to the console.
 * Truncates large nested objects (e.g. tool_input/tool_response) to avoid log spam.
 */
function logHookEvent(eventSlug, body) {
  const color = EVENT_COLORS[eventSlug] || C.gray;
  const label = eventSlug.toUpperCase().replace(/-/g, '_');
  const ts = new Date().toISOString();

  console.log(`\n${color}${C.bold}[HOOK] ${label}${C.reset}  ${C.gray}${ts}${C.reset}`);

  // Print key fields inline for fast scanning
  if (body.session_id)  console.log(`  ${C.gray}session_id:${C.reset}  ${body.session_id}`);
  if (body.cwd)         console.log(`  ${C.gray}cwd:${C.reset}         ${body.cwd}`);
  if (body.tool_name)   console.log(`  ${C.gray}tool_name:${C.reset}   ${body.tool_name}`);
  if (body.stop_reason) console.log(`  ${C.gray}stop_reason:${C.reset} ${body.stop_reason}`);
  if (body.cost_usd != null) console.log(`  ${C.gray}cost_usd:${C.reset}    $${body.cost_usd.toFixed(4)}`);
  if (body.message)     console.log(`  ${C.gray}message:${C.reset}     ${body.message}`);

  // Print full payload, truncating long leaf strings
  const sanitized = truncateDeep(body, 300);
  console.log(`  ${C.gray}payload:${C.reset}`, JSON.stringify(sanitized, null, 2).replace(/^/gm, '  '));
}

/**
 * Recursively truncate long string values in an object so logs stay readable.
 */
function truncateDeep(obj, maxLen) {
  if (typeof obj === 'string') return obj.length > maxLen ? obj.slice(0, maxLen) + '…' : obj;
  if (Array.isArray(obj))     return obj.map(v => truncateDeep(v, maxLen));
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = truncateDeep(v, maxLen);
    return out;
  }
  return obj;
}

// ─── Hook Endpoints ─────────────────────────────────────────

router.post('/session-start', (req, res) => {
  logHookEvent('session-start', req.body || {});
  res.json({ ok: true });
});

router.post('/pre-tool-use', (req, res) => {
  logHookEvent('pre-tool-use', req.body || {});
  res.json({ ok: true });
});

router.post('/post-tool-use', (req, res) => {
  logHookEvent('post-tool-use', req.body || {});
  res.json({ ok: true });
});

router.post('/notification', (req, res) => {
  logHookEvent('notification', req.body || {});
  res.json({ ok: true });
});

router.post('/stop', (req, res) => {
  logHookEvent('stop', req.body || {});
  res.json({ ok: true });
});

router.post('/subagent-stop', (req, res) => {
  logHookEvent('subagent-stop', req.body || {});
  res.json({ ok: true });
});

module.exports = { hooksRouter: router };
```

**Step 2: Verify file exists**

```bash
node -e "const { hooksRouter } = require('./src/web/hooks-router'); console.log('ok', typeof hooksRouter)"
```

Expected: `ok function`

---

### Task 2: Mount the router in server.js

**Files:**
- Modify: `src/web/server.js` (around line 176 — after the health check, before requireAuth routes)

**Step 1: Add the require near the top of server.js**

Find the line:
```js
const { backupFrontend, restoreFrontend, getBackupStatus } = require('./backup');
```

Add immediately after it:
```js
const { hooksRouter } = require('./hooks-router');
```

**Step 2: Mount the router**

Find this comment block in server.js (around line 165–175):
```js
// ─── Health Check (no auth) ─────────────────────────────────

const serverStartTime = Date.now();

app.get('/api/health', ...);
```

After the health check route (after the closing `});` of `app.get('/api/health', ...)`), add:

```js
// ─── Claude Code Hooks (no auth — localhost only) ────────────

app.use('/hooks', hooksRouter);
```

**Step 3: Verify the server starts cleanly**

```bash
node -e "
process.env.CWM_NO_OPEN='1';
// just require to check syntax
require('./src/web/server.js');
" 2>&1 | head -5
```

Expected: No syntax errors (may print startup messages).

**Step 4: Smoke-test a hook endpoint with curl**

Start the server in a separate terminal first (`node src/gui.js`), then:

```bash
curl -s -X POST http://localhost:3456/hooks/session-start \
  -H "Content-Type: application/json" \
  -d '{"session_id":"test-123","cwd":"/tmp/test","timestamp":"2026-03-06T00:00:00Z"}' \
  | node -e "process.stdin.resume(); let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>console.log(JSON.parse(d)))"
```

Expected response: `{ ok: true }`
Expected console output on server: a colored `[HOOK] SESSION_START` block.

**Step 5: Commit**

```bash
git add src/web/hooks-router.js src/web/server.js
git commit -m "feat(hooks): add HTTP hook endpoints for all Claude Code events"
```

---

### Task 3: Create the install script

**Files:**
- Create: `scripts/install-hooks.js`

**Step 1: Create the file**

```js
#!/usr/bin/env node
/**
 * Install Claude Code HTTP hooks pointing at the CWM server.
 *
 * Reads ~/.claude/settings.json, merges the hook config for all
 * six Claude Code events, and writes it back. Idempotent — safe
 * to run multiple times.
 *
 * Usage:
 *   node scripts/install-hooks.js [--port 3456] [--dry-run]
 *
 * Flags:
 *   --port <n>   Port the CWM server is running on (default: 3456)
 *   --dry-run    Print what would be written without modifying the file
 *   --remove     Remove CWM hooks from settings.json instead of adding
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ─── CLI Args ───────────────────────────────────────────────

const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const PORT    = portArg !== -1 ? parseInt(args[portArg + 1], 10) : 3456;
const DRY_RUN = args.includes('--dry-run');
const REMOVE  = args.includes('--remove');

if (isNaN(PORT) || PORT < 1 || PORT > 65535) {
  console.error('Error: --port must be a valid port number (1-65535)');
  process.exit(1);
}

// ─── Settings File Path ─────────────────────────────────────

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

// ─── Hook Event Definitions ─────────────────────────────────

const BASE_URL = `http://localhost:${PORT}`;

// Maps Claude Code event name → URL slug
const HOOK_EVENTS = [
  { event: 'SessionStart',  slug: 'session-start'  },
  { event: 'PreToolUse',    slug: 'pre-tool-use'   },
  { event: 'PostToolUse',   slug: 'post-tool-use'  },
  { event: 'Notification',  slug: 'notification'   },
  { event: 'Stop',          slug: 'stop'           },
  { event: 'SubagentStop',  slug: 'subagent-stop'  },
];

// The URL marker we use to identify CWM-owned hook entries
const CWM_MARKER = `/hooks/`;

// ─── Load settings.json ─────────────────────────────────────

function loadSettings() {
  if (!fs.existsSync(SETTINGS_PATH)) {
    console.log(`No settings.json found at ${SETTINGS_PATH} — will create it.`);
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch (e) {
    console.error(`Failed to parse ${SETTINGS_PATH}: ${e.message}`);
    process.exit(1);
  }
}

// ─── Merge logic ────────────────────────────────────────────

/**
 * Return the hook entry object for a given event slug.
 */
function makeHookEntry(slug) {
  return { hooks: [{ type: 'http', url: `${BASE_URL}/hooks/${slug}` }] };
}

/**
 * Given an existing array of hook entries for an event,
 * remove any CWM-owned entries, then prepend the fresh CWM entry.
 * Returns the new array.
 */
function mergeEventHooks(existing, slug) {
  // Filter out any existing CWM hook entries for this event
  const filtered = (existing || []).filter(entry => {
    const urls = (entry.hooks || []).map(h => h.url || '');
    return !urls.some(u => u.includes(CWM_MARKER));
  });
  return [makeHookEntry(slug), ...filtered];
}

/**
 * Given an existing array of hook entries, remove all CWM-owned entries.
 */
function removeEventHooks(existing) {
  return (existing || []).filter(entry => {
    const urls = (entry.hooks || []).map(h => h.url || '');
    return !urls.some(u => u.includes(CWM_MARKER));
  });
}

// ─── Main ───────────────────────────────────────────────────

function main() {
  const settings = loadSettings();

  if (!settings.hooks) settings.hooks = {};

  for (const { event, slug } of HOOK_EVENTS) {
    if (REMOVE) {
      settings.hooks[event] = removeEventHooks(settings.hooks[event]);
      if (settings.hooks[event].length === 0) delete settings.hooks[event];
    } else {
      settings.hooks[event] = mergeEventHooks(settings.hooks[event], slug);
    }
  }

  // Clean up empty hooks object
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

  const output = JSON.stringify(settings, null, 2) + '\n';

  if (DRY_RUN) {
    console.log('--- DRY RUN: would write to', SETTINGS_PATH, '---');
    console.log(output);
    return;
  }

  // Ensure ~/.claude exists
  const claudeDir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  fs.writeFileSync(SETTINGS_PATH, output, 'utf8');

  if (REMOVE) {
    console.log(`Removed CWM hooks from ${SETTINGS_PATH}`);
  } else {
    console.log(`Installed CWM hooks in ${SETTINGS_PATH} (port ${PORT})`);
    console.log('');
    console.log('Events wired:');
    for (const { event, slug } of HOOK_EVENTS) {
      console.log(`  ${event.padEnd(14)} -> ${BASE_URL}/hooks/${slug}`);
    }
    console.log('');
    console.log('Restart Claude Code for changes to take effect.');
  }
}

main();
```

**Step 2: Test dry-run (does not modify settings.json)**

```bash
node scripts/install-hooks.js --dry-run
```

Expected: Prints what would be written to `~/.claude/settings.json` without modifying the file.

**Step 3: Test idempotency**

```bash
node scripts/install-hooks.js --port 3456
node scripts/install-hooks.js --port 3456
```

Run twice — the second run should produce identical output and not duplicate hooks.

Verify:
```bash
node -e "
const fs = require('fs'), os = require('os'), path = require('path');
const s = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8'));
const counts = Object.entries(s.hooks || {}).map(([k,v]) => k + ':' + v.length);
console.log('Hook entry counts:', counts.join(', '));
"
```

Expected: Each event has exactly 1 entry (not 2 from running twice).

**Step 4: Test --remove flag**

```bash
node scripts/install-hooks.js --remove --dry-run
```

Expected: Dry-run output showing the hooks removed, other settings preserved.

**Step 5: Commit**

```bash
git add scripts/install-hooks.js
git commit -m "feat(hooks): add install script for Claude Code hook registration"
```

---

### Task 4: Update package.json with a convenience script

**Files:**
- Modify: `package.json`

**Step 1: Read current scripts section**

```bash
node -e "const p = require('./package.json'); console.log(JSON.stringify(p.scripts, null, 2))"
```

**Step 2: Add the install-hooks script**

In `package.json`, under `"scripts"`, add:
```json
"hooks:install": "node scripts/install-hooks.js",
"hooks:remove":  "node scripts/install-hooks.js --remove",
"hooks:dry-run": "node scripts/install-hooks.js --dry-run"
```

**Step 3: Verify**

```bash
npm run hooks:dry-run
```

Expected: Dry-run output printed.

**Step 4: Commit**

```bash
git add package.json
git commit -m "feat(hooks): add npm scripts for hook install/remove"
```

---

## Final verification

1. Start the server: `node src/gui.js`
2. Run: `node scripts/install-hooks.js`
3. Open a new Claude Code session — you should see a `[HOOK] SESSION_START` block in the CWM server console
4. Run a tool in that session — you should see `[HOOK] PRE_TOOL_USE` and `[HOOK] POST_TOOL_USE`
5. End the session — you should see `[HOOK] STOP`
