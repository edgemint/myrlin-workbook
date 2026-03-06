# Hook-Driven Session State & Notifications Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Use Claude Code hook events to drive real-time session state transitions (active, awaiting_input, idle, stopped, error) and configurable browser notifications.

**Architecture:** Event bus pattern. The hooks router emits events on a shared EventEmitter. A new HookStateManager module listens, computes state transitions, updates the store, and triggers SSE broadcasts + notifications. Frontend receives state changes via SSE.

**Tech Stack:** Node.js EventEmitter, Express, existing store/SSE infrastructure

---

## Reference: Key Codebase Locations

- **Store singleton**: `src/state/store.js` — `getStore()` at line 1024
- **Session schema**: `src/state/store.js:361` — `{ id, name, workspaceId, resumeSessionId, status, ... }`
- **updateSession()**: `src/state/store.js:384` — `Object.assign(session, updates)`
- **Settings**: `src/state/store.js:36` (defaults), line 193 (getter), line 1008 (`updateSettings`)
- **SSE broadcast**: `src/web/server.js:4328` — `broadcastSSE(eventType, data)`
- **SSE store wiring**: `src/web/server.js:4352` — `attachStoreEvents()`
- **Settings API**: `src/web/server.js:2534` (GET), line 2542 (PUT, allowed: `['subscriptionBudget']`)
- **Frontend SSE handler**: `src/web/public/app.js:7620` — `handleSSEEvent(data)`
- **Existing browser notif**: `src/web/public/app.js:10019` — `new Notification('CWM', ...)`
- **Hooks router**: `src/web/hooks-router.js:93` — catch-all `/:event` POST handler

---

### Task 1: Add hookState field and notification settings to the store

**Files:**
- Modify: `src/state/store.js:22-43` (DEFAULT_STATE) and `src/state/store.js:361-375` (session schema)

**Step 1: Add notification settings to DEFAULT_STATE.settings**

In `src/state/store.js`, find the `settings` block inside `DEFAULT_STATE` (line 36):

```js
settings: {
    autoRecover: true,
    notificationLevel: 'all', // 'all' | 'errors' | 'none'
    theme: 'dark',
    confirmBeforeClose: true,
    subscriptionBudget: 0,
},
```

Add after `subscriptionBudget`:

```js
    hookNotifications: {
      enabled: true,
      triggers: {
        awaiting_input: true,
        permission_needed: true,
        task_completed: true,
        tool_failure: false,
        session_error: false,
        idle: false,
      },
      idleTimeoutMinutes: 5,
    },
```

**Step 2: Add hookState to the session creation**

In `src/state/store.js`, in the `createSession` method (line 361), find:

```js
    const session = {
      id,
      name,
      workspaceId,
      workingDir,
      topic,
      command,
      resumeSessionId,
      status: 'stopped',
      pid: null,
      tags: Array.isArray(tags) ? tags : [],
      createdAt: now,
      lastActive: now,
      logs: [],
    };
```

Add after `logs: [],`:

```js
      hookState: null, // null | 'active' | 'awaiting_input' | 'idle' | 'stopped' | 'error'
```

**Step 3: Verify syntax**

```bash
node --check src/state/store.js
```

**Step 4: Commit**

```bash
git add src/state/store.js
git commit -m "feat(hooks): add hookState field and notification settings to store"
```

---

### Task 2: Create the HookStateManager module

**Files:**
- Create: `src/core/hook-state-manager.js`

**Step 1: Create the file**

```js
/**
 * Hook State Manager
 *
 * Listens for Claude Code hook events (emitted by the hooks router),
 * computes session state transitions, updates the store, and triggers
 * notifications via SSE broadcast.
 *
 * State machine:
 *   SessionStart / PreToolUse / PostToolUse / UserPromptSubmit → active
 *   Stop / PermissionRequest → awaiting_input
 *   No activity for N min after awaiting_input → idle
 *   SessionEnd → stopped
 *   3+ PostToolUseFailure in 60s → error
 */

'use strict';

const { EventEmitter } = require('events');
const { getStore } = require('../state/store');

// Hook event slugs that indicate Claude is actively working
const ACTIVE_EVENTS = new Set([
  'session-start',
  'pre-tool-use',
  'post-tool-use',
  'user-prompt-submit',
  'instructions-loaded',
  'subagent-start',
  'pre-compact',
]);

// Hook event slugs that indicate Claude is waiting for user
const AWAITING_EVENTS = new Set([
  'stop',
  'permission-request',
]);

// How many failures in the window trigger error state
const ERROR_FAILURE_THRESHOLD = 3;
const ERROR_WINDOW_MS = 60_000;

class HookStateManager {
  /**
   * @param {object} opts
   * @param {EventEmitter} opts.hookBus — the EventEmitter that hooks-router emits on
   * @param {function} opts.broadcastSSE — the server's broadcastSSE function
   */
  constructor({ hookBus, broadcastSSE }) {
    this._hookBus = hookBus;
    this._broadcastSSE = broadcastSSE;
    this._idleTimers = new Map();       // claudeSessionId → timeoutId
    this._failureWindows = new Map();   // claudeSessionId → [timestamp, ...]

    this._hookBus.on('hook', (event) => this._handleHookEvent(event));
  }

  _handleHookEvent({ slug, payload }) {
    const claudeSessionId = payload.session_id;
    if (!claudeSessionId) return;

    const cwd = payload.cwd || null;

    // Find the matching managed session
    const session = this._findSession(claudeSessionId, cwd);

    if (slug === 'session-end') {
      this._transition(session, claudeSessionId, 'stopped', slug, payload);
      this._clearIdleTimer(claudeSessionId);
      this._failureWindows.delete(claudeSessionId);
      return;
    }

    if (slug === 'post-tool-use-failure') {
      this._recordFailure(claudeSessionId);
      if (this._isErrorThresholdMet(claudeSessionId)) {
        this._transition(session, claudeSessionId, 'error', slug, payload);
      }
      return;
    }

    // Successful tool use resets the failure counter
    if (slug === 'post-tool-use') {
      this._failureWindows.delete(claudeSessionId);
    }

    if (ACTIVE_EVENTS.has(slug)) {
      this._clearIdleTimer(claudeSessionId);
      this._transition(session, claudeSessionId, 'active', slug, payload);
      return;
    }

    if (AWAITING_EVENTS.has(slug)) {
      this._transition(session, claudeSessionId, 'awaiting_input', slug, payload);
      this._startIdleTimer(claudeSessionId, cwd);
      return;
    }

    // For other events (config-change, worktree-*, teammate-idle, etc.)
    // just broadcast but don't transition state
    if (session) {
      this._broadcastSSE('session:hook-event', {
        sessionId: session.id,
        claudeSessionId,
        slug,
        payload,
      });
    }
  }

  /**
   * Find a managed session matching the given Claude session ID.
   * Falls back to matching by cwd if no resumeSessionId match.
   * Returns null if no match (we don't auto-create for now).
   */
  _findSession(claudeSessionId, cwd) {
    const store = getStore();
    const sessions = Object.values(store.sessions);

    // Primary: match by resumeSessionId
    const byResume = sessions.find(s => s.resumeSessionId === claudeSessionId);
    if (byResume) return byResume;

    // Secondary: match by cwd (for discovered sessions that were dragged in)
    if (cwd) {
      const byCwd = sessions.find(s =>
        s.workingDir && s.status !== 'stopped' &&
        s.workingDir.replace(/\\/g, '/').toLowerCase() === cwd.replace(/\\/g, '/').toLowerCase()
      );
      if (byCwd) return byCwd;
    }

    return null;
  }

  _transition(session, claudeSessionId, newState, slug, payload) {
    if (!session) {
      // No managed session matched — just broadcast the raw event
      this._broadcastSSE('session:hook-state', {
        sessionId: null,
        claudeSessionId,
        hookState: newState,
        trigger: slug,
      });
      return;
    }

    const oldState = session.hookState;
    if (oldState === newState) return; // No change

    // Update the store
    const store = getStore();
    store.updateSession(session.id, { hookState: newState });

    // Broadcast state change via SSE
    this._broadcastSSE('session:hook-state', {
      sessionId: session.id,
      claudeSessionId,
      hookState: newState,
      previousState: oldState,
      trigger: slug,
      toolName: payload.tool_name || null,
      message: payload.message || payload.last_assistant_message || null,
    });

    // Check notification triggers
    this._maybeNotify(session, newState, slug, payload);
  }

  _maybeNotify(session, newState, slug, payload) {
    const store = getStore();
    const notifSettings = store.settings.hookNotifications;
    if (!notifSettings || !notifSettings.enabled) return;

    const triggers = notifSettings.triggers || {};
    let shouldNotify = false;
    let notifType = null;
    let notifMessage = null;

    if (newState === 'awaiting_input' && slug === 'stop' && triggers.awaiting_input) {
      shouldNotify = true;
      notifType = 'awaiting_input';
      notifMessage = `Waiting for your input`;
    } else if (newState === 'awaiting_input' && slug === 'permission-request' && triggers.permission_needed) {
      shouldNotify = true;
      notifType = 'permission_needed';
      notifMessage = `Needs permission for ${payload.tool_name || 'a tool'}`;
    } else if (slug === 'task-completed' && triggers.task_completed) {
      shouldNotify = true;
      notifType = 'task_completed';
      notifMessage = `Task completed`;
    } else if (newState === 'error' && triggers.session_error) {
      shouldNotify = true;
      notifType = 'session_error';
      notifMessage = `Repeated tool failures detected`;
    } else if (newState === 'idle' && triggers.idle) {
      shouldNotify = true;
      notifType = 'idle';
      notifMessage = `Session went idle`;
    }

    if (shouldNotify) {
      this._broadcastSSE('session:notification', {
        sessionId: session.id,
        claudeSessionId,
        type: notifType,
        sessionName: session.name || session.id,
        workspaceName: this._getWorkspaceName(session.workspaceId),
        message: notifMessage,
      });
    }
  }

  _getWorkspaceName(workspaceId) {
    if (!workspaceId) return null;
    const store = getStore();
    const ws = store.workspaces[workspaceId];
    return ws ? ws.name : null;
  }

  // ─── Idle Timer ─────────────────────────────────────────────

  _startIdleTimer(claudeSessionId, cwd) {
    this._clearIdleTimer(claudeSessionId);
    const store = getStore();
    const timeoutMin = (store.settings.hookNotifications || {}).idleTimeoutMinutes || 5;

    const timer = setTimeout(() => {
      this._idleTimers.delete(claudeSessionId);
      const session = this._findSession(claudeSessionId, cwd);
      if (session && session.hookState === 'awaiting_input') {
        this._transition(session, claudeSessionId, 'idle', 'idle-timeout', {});
      }
    }, timeoutMin * 60_000);

    // Don't hold the process open for idle timers
    timer.unref();
    this._idleTimers.set(claudeSessionId, timer);
  }

  _clearIdleTimer(claudeSessionId) {
    const timer = this._idleTimers.get(claudeSessionId);
    if (timer) {
      clearTimeout(timer);
      this._idleTimers.delete(claudeSessionId);
    }
  }

  // ─── Error Detection ───────────────────────────────────────

  _recordFailure(claudeSessionId) {
    const now = Date.now();
    let failures = this._failureWindows.get(claudeSessionId) || [];
    failures.push(now);
    // Trim to window
    failures = failures.filter(t => now - t < ERROR_WINDOW_MS);
    this._failureWindows.set(claudeSessionId, failures);
  }

  _isErrorThresholdMet(claudeSessionId) {
    const failures = this._failureWindows.get(claudeSessionId) || [];
    return failures.length >= ERROR_FAILURE_THRESHOLD;
  }

  // ─── Cleanup ────────────────────────────────────────────────

  destroy() {
    for (const timer of this._idleTimers.values()) clearTimeout(timer);
    this._idleTimers.clear();
    this._failureWindows.clear();
  }
}

module.exports = { HookStateManager };
```

**Step 2: Verify syntax**

```bash
node --check src/core/hook-state-manager.js
```

**Step 3: Commit**

```bash
git add src/core/hook-state-manager.js
git commit -m "feat(hooks): add HookStateManager for hook-driven session states"
```

---

### Task 3: Wire hooks router to emit events on the shared bus

**Files:**
- Modify: `src/web/hooks-router.js`

**Step 1: Add EventEmitter export and emit in the handler**

Replace the current module with:

```js
/**
 * Express Router for Claude Code HTTP hook endpoints.
 *
 * Claude Code calls these URLs on lifecycle events. A single catch-all
 * route accepts any event slug, logs it, emits on the hook bus, and
 * returns { ok: true }.
 * No auth required — these are localhost-only calls from Claude Code.
 *
 * Mount with: app.use('/hooks', hooksRouter);
 */

'use strict';

const { Router } = require('express');
const { EventEmitter } = require('events');

const router = Router();
const hookBus = new EventEmitter();

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
  'session-start':        C.green,
  'instructions-loaded':  C.green,
  'user-prompt-submit':   C.cyan,
  'pre-tool-use':         C.yellow,
  'permission-request':   C.yellow,
  'post-tool-use':        C.cyan,
  'post-tool-use-failure': C.red,
  'notification':         C.blue,
  'subagent-start':       C.magenta,
  'subagent-stop':        C.red,
  'teammate-idle':        C.gray,
  'task-completed':       C.green,
  'config-change':        C.blue,
  'worktree-create':      C.cyan,
  'worktree-remove':      C.yellow,
  'pre-compact':          C.gray,
  'stop':                 C.magenta,
  'session-end':          C.magenta,
};

/**
 * Pretty-print a hook payload to the console.
 */
function logHookEvent(eventSlug, body) {
  const color = EVENT_COLORS[eventSlug] || C.gray;
  const label = eventSlug.toUpperCase().replace(/-/g, '_');
  const ts = new Date().toISOString();

  console.log(`\n${color}${C.bold}[HOOK] ${label}${C.reset}  ${C.gray}${ts}${C.reset}`);

  if (body.session_id)  console.log(`  ${C.gray}session_id:${C.reset}  ${body.session_id}`);
  if (body.cwd)         console.log(`  ${C.gray}cwd:${C.reset}         ${body.cwd}`);
  if (body.tool_name)   console.log(`  ${C.gray}tool_name:${C.reset}   ${body.tool_name}`);
  if (body.stop_reason) console.log(`  ${C.gray}stop_reason:${C.reset} ${body.stop_reason}`);
  if (body.cost_usd != null) console.log(`  ${C.gray}cost_usd:${C.reset}    $${body.cost_usd.toFixed(4)}`);
  if (body.message)     console.log(`  ${C.gray}message:${C.reset}     ${body.message}`);

  const sanitized = truncateDeep(body, 300);
  console.log(`  ${C.gray}payload:${C.reset}`, JSON.stringify(sanitized, null, 2).replace(/^/gm, '  '));
}

function truncateDeep(obj, maxLen) {
  if (typeof obj === 'string') return obj.length > maxLen ? obj.slice(0, maxLen) + '...' : obj;
  if (Array.isArray(obj))     return obj.map(v => truncateDeep(v, maxLen));
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = truncateDeep(v, maxLen);
    return out;
  }
  return obj;
}

// ─── Hook Endpoints ─────────────────────────────────────────

router.post('/:event', (req, res) => {
  const slug = req.params.event;
  const payload = req.body || {};
  logHookEvent(slug, payload);
  hookBus.emit('hook', { slug, payload });
  res.json({ ok: true });
});

module.exports = { hooksRouter: router, hookBus };
```

**Step 2: Verify syntax**

```bash
node --check src/web/hooks-router.js
```

**Step 3: Commit**

```bash
git add src/web/hooks-router.js
git commit -m "feat(hooks): emit hook events on shared EventEmitter bus"
```

---

### Task 4: Initialize HookStateManager in the server

**Files:**
- Modify: `src/web/server.js` — add require, instantiate manager in `startServer()`

**Step 1: Add require**

Find (around line 21):
```js
const { hooksRouter } = require('./hooks-router');
```

Replace with:
```js
const { hooksRouter, hookBus } = require('./hooks-router');
const { HookStateManager } = require('../core/hook-state-manager');
```

**Step 2: Initialize manager inside startServer**

Find the `startServer` function (around line 6531). Find the `attachStoreEvents()` call inside it. After that call, add:

```js
    // Initialize hook state manager (hooks → state transitions → SSE)
    const hookStateManager = new HookStateManager({ hookBus, broadcastSSE });
```

**Step 3: Expand allowed settings keys in PUT /api/settings**

Find (line 2543):
```js
  const allowed = ['subscriptionBudget'];
```

Replace with:
```js
  const allowed = ['subscriptionBudget', 'hookNotifications'];
```

**Step 4: Verify syntax**

```bash
node --check src/web/server.js
```

**Step 5: Commit**

```bash
git add src/web/server.js
git commit -m "feat(hooks): wire HookStateManager into server startup"
```

---

### Task 5: Handle hook state SSE events in the frontend

**Files:**
- Modify: `src/web/public/app.js` — `handleSSEEvent()` method (line 7620)

**Step 1: Add session:hook-state and session:notification cases**

In the `handleSSEEvent(data)` switch statement (line 7628), add before the `default:` or at the end of existing cases:

```js
      case 'session:hook-state': {
        // Update the session's hookState in local cache
        if (data.data && data.data.sessionId) {
          const sid = data.data.sessionId;
          const sessions = this.state.sessions || [];
          const session = sessions.find(s => s.id === sid);
          if (session) {
            session.hookState = data.data.hookState;
          }
        }
        // Re-render session list to show new state badge
        this.loadSessions().then(() => { if (this._smOpen) this.renderSessionManager(); });
        break;
      }

      case 'session:notification': {
        const d = data.data || {};
        const name = d.sessionName || 'Session';
        const wsName = d.workspaceName ? ` (${d.workspaceName})` : '';
        const msg = d.message || 'needs attention';

        // In-app toast
        this.showToast(`${name}${wsName}: ${msg}`, 'info');

        // Browser notification (if enabled and window not focused)
        if (this.getSetting('browserNotifications') &&
            Notification.permission === 'granted' &&
            (document.hidden || !document.hasFocus())) {
          const notif = new Notification('CWM', {
            body: `${name}${wsName}: ${msg}`,
            icon: '/favicon.ico',
          });
          notif.onclick = () => {
            window.focus();
            // Try to navigate to the session if possible
            if (d.sessionId) {
              const idx = (this.state.sessions || []).findIndex(s => s.id === d.sessionId);
              if (idx >= 0) this._navigateToSession(d.sessionId, idx);
            }
          };
        }

        // Flash browser title
        this._flashBrowserTitle(name);
        break;
      }
```

**Step 2: Verify the file isn't broken (app.js is huge, just check it loads)**

Open the CWM UI in browser, check the console for no JS errors.

**Step 3: Commit**

```bash
git add src/web/public/app.js
git commit -m "feat(hooks): handle hook-state SSE events and browser notifications in frontend"
```

---

### Task 6: Render hookState badges in session UI

**Files:**
- Modify: `src/web/public/app.js` — session card rendering

**Step 1: Find where session status badges are rendered**

Search for where session status/state is displayed in the session list/cards. Look for references to `session.status` in the rendering code. Add hookState badge rendering alongside or replacing the existing status:

The hookState badge should show:
- `active` → green dot + "Active"
- `awaiting_input` → yellow dot + "Awaiting Input"
- `idle` → gray dot + "Idle"
- `stopped` → red dot + "Stopped"
- `error` → red pulsing dot + "Error"
- `null` (no hook data yet) → show existing `session.status` as fallback

Use this badge HTML pattern (adapted to match existing CSS):
```js
const hookBadge = session.hookState
  ? `<span class="hook-state-badge hook-state-${session.hookState}">${
      session.hookState.replace(/_/g, ' ')
    }</span>`
  : '';
```

**Step 2: Add CSS for hook state badges**

Add to the appropriate stylesheet (or inline in app.js styles section):
```css
.hook-state-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  text-transform: capitalize;
}
.hook-state-active { background: #22c55e22; color: #22c55e; }
.hook-state-awaiting_input { background: #eab30822; color: #eab308; }
.hook-state-idle { background: #6b728022; color: #6b7280; }
.hook-state-stopped { background: #ef444422; color: #ef4444; }
.hook-state-error { background: #ef444444; color: #ef4444; animation: pulse 1.5s infinite; }
```

**Step 3: Commit**

```bash
git add src/web/public/app.js
git commit -m "feat(hooks): render hookState badges on session cards"
```

Note: Task 6 requires exploring the session rendering code to find the exact insertion point. The implementer should search for where `session.status` is rendered in cards/lists.

---

### Task 7: Add notification settings UI

**Files:**
- Modify: `src/web/public/app.js` — settings panel rendering

**Step 1: Find the settings panel rendering code**

Search for where settings toggles are rendered (near the `browserNotifications` toggle around line 4618). Add a new "Hook Notifications" section with toggles for each trigger.

The settings section should include:
- Master toggle: "Hook Notifications" (on/off)
- Per-trigger toggles: awaiting_input, permission_needed, task_completed, tool_failure, session_error, idle
- Idle timeout: number input (minutes)

**Step 2: Wire toggles to settings save**

Each toggle should update `this.state.settings.hookNotifications.triggers[key]` and call `this.saveSettings()` which PUTs to `/api/settings`.

**Step 3: Commit**

```bash
git add src/web/public/app.js
git commit -m "feat(hooks): add notification settings UI for hook triggers"
```

Note: Task 7 requires exploring the settings panel rendering. The implementer should search for `renderSettingsPanel` or `settingsBody` in app.js to find the insertion point.

---

## Smoke Test Procedure

After all tasks are done:

1. Start the CWM server: `npm run gui`
2. Run `npm run hooks:install` if not already installed
3. Restart Claude Code to pick up hooks
4. Open the CWM UI in browser
5. Start a Claude Code session from the CWM UI
6. Watch the session card — it should show:
   - "Active" badge while Claude is using tools
   - "Awaiting Input" badge when Claude finishes
   - After 5 min idle → "Idle" badge
7. Check browser notifications fire when Claude stops (window must be unfocused)
8. Open Settings → verify notification toggles appear and persist
9. Toggle off "Awaiting Input" notifications → verify they stop firing
