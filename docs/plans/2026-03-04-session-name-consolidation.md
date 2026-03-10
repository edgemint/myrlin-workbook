# Session Name Consolidation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace split localStorage+fire-and-forget session naming with a single server-persisted claudeUUID→name map.

**Architecture:** Add `sessionNames: { [claudeUUID]: string }` to the store's persisted state. Add server endpoints to read/write it. On the frontend, boot-load the map, display through one lookup function, write through one endpoint — no localStorage, no sync loops.

**Tech Stack:** Node.js, Express, vanilla JS (no build step, direct file edits)

---

## Task 1: Store — add `sessionNames` map and methods

**File:** `src/state/store.js`

### Step 1 — Write the unit test inline (verify before touching prod code)

Create a scratch test file at `test/unit-store-session-names.js`:

```js
#!/usr/bin/env node
// Quick unit test for Store.setSessionName / getSessionName / getAllSessionNames
const os = require('os');
const fs = require('fs');
const path = require('path');

// Point the store at a temp dir so we don't pollute real state
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwm-test-'));
process.env.CWM_STATE_DIR = tmpDir; // Store reads this if we wire it — or we patch after require

// Monkey-patch the STATE_FILE constant by requiring store AFTER setting env
// (Store hard-codes the path at module load — easier to just test via the methods)
const { Store } = require('../src/state/store');
const store = new Store();
store.init(); // loads/creates blank state

let pass = 0, fail = 0;
function check(label, ok) {
  if (ok) { console.log('  PASS  ' + label); pass++; }
  else     { console.log('  FAIL  ' + label); fail++; }
}

check('getSessionName on unknown UUID returns null',
  store.getSessionName('no-such-uuid') === null);

store.setSessionName('uuid-aaa', 'My Test Session');
check('setSessionName stores the name',
  store.getSessionName('uuid-aaa') === 'My Test Session');

store.setSessionName('uuid-bbb', 'Another Session');
const all = store.getAllSessionNames();
check('getAllSessionNames returns both entries',
  all['uuid-aaa'] === 'My Test Session' && all['uuid-bbb'] === 'Another Session');

check('setSessionName with empty name is a no-op',
  (() => { store.setSessionName('uuid-aaa', ''); return store.getSessionName('uuid-aaa') === 'My Test Session'; })());

check('setSessionName with non-string UUID is a no-op',
  (() => { store.setSessionName(null, 'x'); return store.getSessionName(null) === null; })());

console.log(`\n${pass} passed, ${fail} failed`);
fs.rmSync(tmpDir, { recursive: true, force: true });
process.exit(fail > 0 ? 1 : 0);
```

### Step 2 — Run (expect failure: methods don't exist yet)

```bash
node test/unit-store-session-names.js
```

Expected: `TypeError: store.getSessionName is not a function`

### Step 3 — Implement in `src/state/store.js`

**3a. Add to `DEFAULT_STATE` at line 33, after `projectDefaults: {}`:**

```js
  sessionNames: {},      // { [claudeUUID]: string } — display names for all sessions
```

Final block of `DEFAULT_STATE` should look like:
```js
  projectDefaults: {},   // { [encodedName]: { defaultDir: string } }
  sessionNames: {},      // { [claudeUUID]: string } — display names for all sessions
  settings: {
```

**3b. Add to `_tryLoadFile` return object at line 119, after `projectDefaults: parsed.projectDefaults || {}`:**

```js
        sessionNames: parsed.sessionNames || {},
```

Final return block:
```js
      return {
        ...DEFAULT_STATE,
        ...parsed,
        settings: { ...DEFAULT_STATE.settings, ...(parsed.settings || {}) },
        workspaceGroups: parsed.workspaceGroups || {},
        workspaceOrder: parsed.workspaceOrder || [],
        templates: parsed.templates || {},
        features: parsed.features || {},
        worktreeTasks: parsed.worktreeTasks || {},
        projectDefaults: parsed.projectDefaults || {},
        sessionNames: parsed.sessionNames || {},
      };
```

**3c. Add three methods after `setProjectDefault` (after line 218), before `getAllWorkspacesList`:**

```js
  // ─── Session Names ────────────────────────────────────────

  /**
   * Persist a display name for a Claude session UUID.
   * @param {string} claudeUUID - The Claude session UUID
   * @param {string} name - Display name (1–200 chars)
   * @returns {{ claudeUUID: string, name: string } | null}
   */
  setSessionName(claudeUUID, name) {
    if (!claudeUUID || typeof claudeUUID !== 'string') return null;
    if (!name || typeof name !== 'string' || name.trim() === '') return null;
    const trimmed = name.trim().slice(0, 200);
    if (!this._state.sessionNames) this._state.sessionNames = {};
    this._state.sessionNames[claudeUUID] = trimmed;
    this.debouncedSave();
    return { claudeUUID, name: trimmed };
  }

  /**
   * Get a stored display name for a Claude session UUID.
   * @param {string} claudeUUID
   * @returns {string | null}
   */
  getSessionName(claudeUUID) {
    if (!claudeUUID || typeof claudeUUID !== 'string') return null;
    return (this._state.sessionNames && this._state.sessionNames[claudeUUID]) || null;
  }

  /**
   * Return the entire sessionNames map.
   * @returns {{ [claudeUUID: string]: string }}
   */
  getAllSessionNames() {
    return this._state.sessionNames || {};
  }
```

> **Note:** `debouncedSave()` is the existing debounced save method on Store. If it does not exist, replace with `this.save()`. Check by searching for `debouncedSave` in `store.js` — if absent, use `this.save()`.

### Step 4 — Verify pass

```bash
node test/unit-store-session-names.js
```

Expected: `4 passed, 0 failed`

### Step 5 — Commit

```bash
git add src/state/store.js test/unit-store-session-names.js
git commit -m "feat(store): add sessionNames map with set/get/getAll methods"
```

---

## Task 2: Server — add `GET` and `PUT /api/session-names` endpoints

**File:** `src/web/server.js`

### Step 1 — Identify insertion point

The project-defaults block ends around line 3959. Add the new session-names block immediately after it, before the `// SESSION TEMPLATES` comment.

### Step 2 — Write the endpoints

Insert after line 3959 (after the `app.put('/api/project-defaults/...')` handler closes):

```js
// ──────────────────────────────────────────────────────────
//  SESSION NAMES (claudeUUID → display name)
// ──────────────────────────────────────────────────────────

/**
 * GET /api/session-names
 * Returns the full { [claudeUUID]: string } map.
 */
app.get('/api/session-names', requireAuth, (req, res) => {
  const store = getStore();
  res.json(store.getAllSessionNames());
});

/**
 * PUT /api/session-names/:claudeId
 * Body: { name: string }
 * Persists a display name for the given Claude session UUID.
 */
app.put('/api/session-names/:claudeId', requireAuth, (req, res) => {
  const { claudeId } = req.params;
  const { name } = req.body || {};
  if (!claudeId || typeof claudeId !== 'string' || claudeId.trim() === '' || claudeId.length > 128) {
    return res.status(400).json({ error: 'claudeId must be a non-empty string ≤128 chars.' });
  }
  if (!name || typeof name !== 'string' || name.trim() === '' || name.length > 200) {
    return res.status(400).json({ error: 'name must be a non-empty string ≤200 chars.' });
  }
  const store = getStore();
  const result = store.setSessionName(claudeId.trim(), name.trim());
  if (!result) return res.status(400).json({ error: 'Failed to set session name.' });
  res.json({ claudeId: result.claudeUUID, name: result.name });
});
```

### Step 3 — Update `POST /api/sessions/:id/auto-title` (around line 1326)

After `store.updateSession(req.params.id, { name: title });`, add:

```js
    if (session) {
      store.updateSession(req.params.id, { name: title });
    }
    // Also persist to the sessionNames map keyed by Claude UUID
    store.setSessionName(claudeSessionId, title);
```

Full updated block (lines 1324–1328):
```js
    // Update the session name if it's a store session
    if (session) {
      store.updateSession(req.params.id, { name: title });
    }
    // Also persist to the sessionNames map keyed by Claude UUID
    store.setSessionName(claudeSessionId, title);
    return res.json({ success: true, title, claudeSessionId });
```

### Step 4 — Verify server starts without errors

```bash
node src/web/server.js &
sleep 2
curl -s http://localhost:3000/api/session-names -H "Authorization: Bearer test" || echo "Auth required (expected)"
kill %1
```

### Step 5 — Commit

```bash
git add src/web/server.js
git commit -m "feat(server): add GET/PUT /api/session-names endpoints"
```

---

## Task 3: E2E tests for the new endpoints

**File:** `test/e2e-api.js`

### Step 1 — Find insertion point

Search for the last `console.log('\n---` section label, or add after the project-defaults test block. Insert before the final `results` summary printout.

### Step 2 — Add test block inside `run()`

Find the section that ends the existing tests (look for `console.log('\n--- Summary ---')` or the final pass/fail count). Paste the following block immediately before it:

```js
  // ════════════════════════════════════════
  // SESSION NAMES
  // ════════════════════════════════════════
  console.log('\n--- Session Names ---');

  // GET returns 200 with an object
  r = await get('/api/session-names');
  check('GET /api/session-names → 200', r.status === 200);
  check('GET /api/session-names → object', typeof json(r) === 'object' && json(r) !== null);

  // PUT a name for a test UUID
  r = await put('/api/session-names/test-uuid-abc', { name: 'My Test Session' });
  check('PUT /api/session-names/:id → 200', r.status === 200);
  const snResult = json(r);
  check('PUT /api/session-names/:id → correct claudeId', snResult && snResult.claudeId === 'test-uuid-abc');
  check('PUT /api/session-names/:id → correct name', snResult && snResult.name === 'My Test Session');

  // GET again — new entry should be present
  r = await get('/api/session-names');
  check('GET /api/session-names shows newly PUT entry', json(r)['test-uuid-abc'] === 'My Test Session');

  // Reject empty name
  r = await put('/api/session-names/test-uuid-abc', { name: '' });
  check('PUT with empty name → 400', r.status === 400);

  // Reject missing name
  r = await put('/api/session-names/test-uuid-abc', {});
  check('PUT with missing name → 400', r.status === 400);

  // No-ID route should 404
  r = await put('/api/session-names/', { name: 'x' });
  check('PUT /api/session-names/ (no ID) → 404', r.status === 404);
```

### Step 3 — Run (server must be running first)

The test runner at `test/run.js` starts the server automatically. Run:

```bash
node test/run.js
```

Or manually start the server first, then:

```bash
CWM_PASSWORD=test123 PORT=3458 node test/e2e-api.js
```

Expected: all new Session Names tests pass.

### Step 4 — Commit

```bash
git add test/e2e-api.js
git commit -m "test(e2e): add session-names endpoint coverage"
```

---

## Task 4: Frontend — load `sessionNames` on boot

**File:** `src/web/public/app.js`

### Step 1 — Add `loadSessionNames()` method

Find `async loadAll()` (line 1965). Add the new method just above it or near the other `load*` methods (e.g., after `loadSessions` around line 2023):

```js
  /**
   * Load the server-persisted claudeUUID→name map into this.state.sessionNames.
   * Falls back to empty object on any error.
   */
  async loadSessionNames() {
    try {
      const data = await this.api('GET', '/api/session-names');
      this.state.sessionNames = (data && typeof data === 'object') ? data : {};
    } catch (_) {
      this.state.sessionNames = {};
    }
  }
```

### Step 2 — Call it in `loadAll()`

Inside `loadAll()` (line 1965), add `this.loadSessionNames()` to the `Promise.all` block at line 1975:

```js
    await Promise.all([
      this.loadWorkspaces(),
      this.loadStats(),
      this.loadGroups(),
      this.loadProjects(),
      this.loadSessionNames(),   // ← add this line
    ]);
```

### Step 3 — Initialize the state field

In the `App` constructor (or wherever `this.state` is first set up, search for `this.state = {`), add a default:

```js
      sessionNames: {},        // claudeUUID → display name (server-persisted)
```

If `this.state` is built dynamically, just ensure `loadSessionNames()` always populates it before any rendering occurs (which `loadAll()` guarantees).

### Step 4 — Verify by opening the browser DevTools console after reload

```
app.state.sessionNames  // should be {} or a populated object
```

### Step 5 — Commit

```bash
git add src/web/public/app.js
git commit -m "feat(frontend): load sessionNames map from server on boot"
```

---

## Task 5: Frontend — rewrite `getProjectSessionTitle`

**File:** `src/web/public/app.js`, line 3321

### Step 1 — Identify the current body

Current (lines 3321–3329):
```js
  getProjectSessionTitle(claudeSessionId) {
    // Check localStorage first
    const titles = JSON.parse(localStorage.getItem('cwm_projectSessionTitles') || '{}');
    if (titles[claudeSessionId]) return titles[claudeSessionId];
    // Fall back: check if any workspace session with this resumeSessionId has a name
    const allSessions = this.state.allSessions || this.state.sessions || [];
    const linked = allSessions.find(s => s.resumeSessionId === claudeSessionId && s.name);
    return linked ? linked.name : null;
  }
```

### Step 2 — Replace with server-map lookup

```js
  getProjectSessionTitle(claudeSessionId) {
    // Primary: check server-persisted sessionNames map (loaded at boot)
    if (this.state.sessionNames && this.state.sessionNames[claudeSessionId]) {
      return this.state.sessionNames[claudeSessionId];
    }
    // Fallback: check linked workspace sessions (covers sessions predating the new system)
    const allSessions = this.state.allSessions || this.state.sessions || [];
    const linked = allSessions.find(s => s.resumeSessionId === claudeSessionId && s.name);
    return linked ? linked.name : null;
  }
```

No localStorage reads. No change to the fallback logic.

### Step 3 — Verify

In the browser DevTools, name a project session and confirm the title appears after a page reload (it should now come from `this.state.sessionNames`, not localStorage).

### Step 4 — Commit

```bash
git add src/web/public/app.js
git commit -m "refactor(frontend): getProjectSessionTitle reads server map, not localStorage"
```

---

## Task 6: Frontend — rewrite `syncSessionTitle`

**File:** `src/web/public/app.js`, line 3337

### Step 1 — Identify current body (lines 3337–3358)

```js
  syncSessionTitle(claudeSessionId, title) {
    if (!claudeSessionId || !title) return;
    // 1. Update localStorage project titles
    const titles = JSON.parse(localStorage.getItem('cwm_projectSessionTitles') || '{}');
    titles[claudeSessionId] = title;
    localStorage.setItem('cwm_projectSessionTitles', JSON.stringify(titles));
    // 2. Update any workspace sessions that link to this Claude UUID
    const allSessions = this.state.allSessions || [];
    for (const s of allSessions) {
      if (s.resumeSessionId === claudeSessionId && s.name !== title) {
        s.name = title;
        // Fire-and-forget API update
        this.api('PUT', `/api/sessions/${s.id}`, { name: title }).catch(() => {});
      }
    }
    // Also check this.state.sessions (may be a different filtered array)
    for (const s of (this.state.sessions || [])) {
      if (s.resumeSessionId === claudeSessionId && s.name !== title) {
        s.name = title;
      }
    }
  }
```

### Step 2 — Replace with the new async version

```js
  /**
   * Persist a session display name to the server and update the local map.
   * Single source of truth — no localStorage writes, no fire-and-forget loops.
   * @param {string} claudeSessionId - Claude UUID
   * @param {string} title - Display name to store
   */
  async syncSessionTitle(claudeSessionId, title) {
    if (!claudeSessionId || !title || typeof title !== 'string' || title.trim() === '') return;
    const trimmed = title.trim();
    try {
      await this.api('PUT', `/api/session-names/${encodeURIComponent(claudeSessionId)}`, { name: trimmed });
      // Update local map so callers see the change immediately without a reload
      if (!this.state.sessionNames) this.state.sessionNames = {};
      this.state.sessionNames[claudeSessionId] = trimmed;
    } catch (err) {
      this.showToast('Failed to save session name: ' + (err.message || 'unknown error'), 'error');
    }
  }
```

Key changes:
- Method is now `async`
- No `localStorage.setItem` or `getItem`
- No loop over `allSessions` or `this.state.sessions`
- No fire-and-forget `.catch(() => {})`
- Errors surface to the user via `showToast`

### Step 3 — Verify callers

All callers of `syncSessionTitle` must now `await` it. Check:
- `renameSession` line 2461: `if (claudeId && result.name) this.syncSessionTitle(claudeId, result.name);` → change to `await this.syncSessionTitle(...)`
- `autoTitleSession` line 3262: `if (claudeId) this.syncSessionTitle(claudeId, data.title);` → `await this.syncSessionTitle(...)`
- `autoTitleProjectSession` line 3297: `this.syncSessionTitle(claudeSessionId, data.title);` → `await this.syncSessionTitle(...)`

These are already in async methods so `await` is valid.

### Step 4 — Commit

```bash
git add src/web/public/app.js
git commit -m "refactor(frontend): syncSessionTitle writes to server only, no localStorage"
```

---

## Task 7: Frontend — fix `renameSession` and auto-title callers to `await syncSessionTitle`

**File:** `src/web/public/app.js`

### Step 1 — Fix `renameSession` (line 2461)

Current:
```js
      if (claudeId && result.name) this.syncSessionTitle(claudeId, result.name);
```

Replace with:
```js
      if (claudeId && result.name) await this.syncSessionTitle(claudeId, result.name);
```

### Step 2 — Fix `autoTitleSession` (line 3262)

Current:
```js
        if (claudeId) this.syncSessionTitle(claudeId, data.title);
```

Replace with:
```js
        if (claudeId) await this.syncSessionTitle(claudeId, data.title);
```

### Step 3 — Fix `autoTitleProjectSession` (line 3297)

Current:
```js
        this.syncSessionTitle(claudeSessionId, data.title);
```

Replace with:
```js
        await this.syncSessionTitle(claudeSessionId, data.title);
```

### Step 4 — Verify

Run a rename in the UI and check the network tab: you should see one clean `PUT /api/session-names/:id` with a 200 response. No extra `PUT /api/sessions/:id` calls originating from the sync loop.

### Step 5 — Commit

```bash
git add src/web/public/app.js
git commit -m "fix(frontend): await syncSessionTitle in renameSession and autoTitle callers"
```

---

## Task 8: Frontend — migrate existing localStorage titles on first boot

**File:** `src/web/public/app.js`, inside `loadSessionNames()` (added in Task 4)

### Step 1 — Extend `loadSessionNames()` with migration logic

Replace the method body added in Task 4 with:

```js
  /**
   * Load the server-persisted claudeUUID→name map into this.state.sessionNames.
   * On first boot, migrates any titles stored in the legacy localStorage key
   * (cwm_projectSessionTitles) to the server, then removes the localStorage entry.
   */
  async loadSessionNames() {
    try {
      const data = await this.api('GET', '/api/session-names');
      this.state.sessionNames = (data && typeof data === 'object') ? data : {};
    } catch (_) {
      this.state.sessionNames = {};
    }

    // ── One-time migration from legacy localStorage key ──
    const legacyRaw = localStorage.getItem('cwm_projectSessionTitles');
    if (!legacyRaw) return; // Nothing to migrate

    let legacy = {};
    try { legacy = JSON.parse(legacyRaw); } catch (_) { /* corrupt — skip */ }

    const serverMap = this.state.sessionNames;
    const migrations = Object.entries(legacy)
      .filter(([uuid, name]) => uuid && name && !serverMap[uuid]);

    if (migrations.length > 0) {
      // Fire migrations in parallel — tolerate individual failures
      await Promise.allSettled(
        migrations.map(async ([uuid, name]) => {
          try {
            await this.api('PUT', `/api/session-names/${encodeURIComponent(uuid)}`, { name });
            serverMap[uuid] = name; // Update local map immediately
          } catch (_) {
            // Leave the localStorage entry intact if the PUT fails
            delete legacy[uuid]; // Don't count it as migrated
          }
        })
      );
    }

    // Remove the legacy key regardless (even if some entries failed — they'll
    // re-appear next boot from the server map, or remain in localStorage
    // only if we explicitly kept them above)
    localStorage.removeItem('cwm_projectSessionTitles');
    console.log(`[CWM] Migrated ${migrations.length} session name(s) from localStorage to server.`);
  }
```

### Step 2 — Verify migration in DevTools

1. Open the app with existing `cwm_projectSessionTitles` in localStorage.
2. Reload — check the console for `[CWM] Migrated N session name(s)`.
3. Verify `localStorage.getItem('cwm_projectSessionTitles')` returns `null`.
4. Verify `GET /api/session-names` (network tab) includes the migrated UUIDs.

### Step 3 — Commit

```bash
git add src/web/public/app.js
git commit -m "feat(frontend): migrate legacy localStorage session titles to server on first boot"
```

---

## Task 9: PTY — detect new UUID after `/clear` and carry the session name forward

**File:** `src/web/pty-manager.js`

**Problem:** When the user runs `/clear` in Claude, Claude Code creates a new `.jsonl` with a new UUID. The workbook only detects the UUID once at spawn (8s delay), so after `/clear` the `resumeSessionId` in the store is stale — restarts resume the pre-clear session. With our naming map keyed by claudeUUID, the name would also become invisible.

**Fix:** After the initial detection, start a 30s polling interval on the same project directory. When a newer JSONL appears, update `resumeSessionId` in the store and carry the session name forward via `store.setSessionName(newUUID, existingName)`.

### Step 1 — Identify the mutation point in `src/web/pty-manager.js`

The existing one-shot detection block lives at lines 393-451. It runs once, 8s after spawn, only when `!resumeSessionId`. The UUID and project directory path are local to that timeout callback.

### Step 2 — Replace the one-shot timeout with an initial detection + polling loop

Replace lines 393-451 (the `if (resolvedCwd && !resumeSessionId) { setTimeout(...) }` block) with:

```js
    // ── Detect and track Claude session UUID ──
    // Claude creates ~/.claude/projects/<encoded-cwd>/<uuid>.jsonl on first prompt.
    // After /clear it creates a NEW .jsonl — we poll to pick up the change.
    if (resolvedCwd) {
      let trackedUUID = resumeSessionId || null;
      let trackedMtime = 0;

      // Helper: find the project dir and return newest JSONL info
      function findNewestJsonl() {
        try {
          const claudeDir = path.join(os.homedir(), '.claude', 'projects');
          if (!fs.existsSync(claudeDir)) return null;

          const candidates = fs.readdirSync(claudeDir).filter(d => {
            try {
              const decoded = decodeURIComponent(d);
              const normalizedDecoded = decoded.replace(/[/\\]/g, path.sep);
              const normalizedCwd = resolvedCwd.replace(/[/\\]/g, path.sep);
              return normalizedDecoded === normalizedCwd;
            } catch (_) { return false; }
          });

          if (candidates.length === 0) return null;

          const projDir = path.join(claudeDir, candidates[0]);
          const jsonls = fs.readdirSync(projDir)
            .filter(f => f.endsWith('.jsonl'))
            .map(f => {
              try {
                const fp = path.join(projDir, f);
                return { uuid: f.replace('.jsonl', ''), mtime: fs.statSync(fp).mtimeMs };
              } catch (_) { return null; }
            })
            .filter(Boolean)
            .sort((a, b) => b.mtime - a.mtime);

          return jsonls[0] || null;
        } catch (_) { return null; }
      }

      // Apply a newly detected UUID — update store + carry name forward
      function applyDetectedUUID(newUUID, newMtime) {
        if (newUUID === trackedUUID) return; // No change
        const oldUUID = trackedUUID;
        trackedUUID = newUUID;
        trackedMtime = newMtime;

        console.log(`[PTY] New Claude session UUID for ${sessionId}: ${newUUID}${oldUUID ? ' (was ' + oldUUID + ')' : ''}`);

        try {
          const store = getStore();
          if (store.getSession(sessionId)) {
            store.updateSession(sessionId, { resumeSessionId: newUUID });
          }
          // Carry the display name forward to the new UUID
          if (oldUUID) {
            const existingName = store.getSessionName(oldUUID);
            if (existingName) {
              store.setSessionName(newUUID, existingName);
              console.log(`[PTY] Carried session name "${existingName}" to new UUID ${newUUID}`);
            }
          }
        } catch (_) {}

        session.detectedResumeId = newUUID;
      }

      // Initial detection after 8s (Claude needs time to create the file)
      const initTimer = setTimeout(() => {
        const newest = findNewestJsonl();
        if (newest) applyDetectedUUID(newest.uuid, newest.mtime);
      }, 8000);

      // Polling interval: pick up /clear-generated UUIDs while the session runs
      const pollInterval = setInterval(() => {
        const newest = findNewestJsonl();
        if (newest && newest.mtime > trackedMtime) {
          applyDetectedUUID(newest.uuid, newest.mtime);
        }
      }, 30000); // every 30s

      // Clean up timers when the session is destroyed
      const origDestroy = session.destroy ? session.destroy.bind(session) : null;
      session.destroy = () => {
        clearTimeout(initTimer);
        clearInterval(pollInterval);
        if (origDestroy) origDestroy();
      };
    }
```

### Step 3 — Verify: manually test `/clear` flow

1. Start a session in the workbook that points at a real directory.
2. Let it connect (UUID detected at 8s, visible in server logs as `[PTY] New Claude session UUID`).
3. Type `/clear` in the Claude terminal.
4. Wait up to 30s (next poll), then check server logs for `[PTY] New Claude session UUID for ... (was ...)`.
5. Also verify: if the session had a name, it should appear under the new UUID in `/api/session-names` (check via `curl` or the network tab).

### Step 4 — Commit

```bash
git add src/web/pty-manager.js
git commit -m "fix(pty): poll for new Claude UUID after /clear and carry session name forward"
```

---

## Task 10: Final integration commit

### Step 1 — Run full E2E suite

```bash
node test/run.js
```

All session-names tests must pass. No regressions in other sections.

### Step 2 — Smoke-test the UI

1. Start the server: `npm start`
2. Open the app, rename a session — confirm `PUT /api/session-names/:id` in the network tab.
3. Reload — confirm the name persists (read from `GET /api/session-names` at boot).
4. Open a second browser tab — confirm the same name appears (both tabs see server state, not tab-local localStorage).
5. Trigger auto-title on a project session — confirm the title appears and persists on reload.
6. Run `/clear` in a named session, wait 30s, confirm the name follows the new UUID.

### Step 3 — Consolidation commit

```bash
git add src/state/store.js src/web/server.js src/web/public/app.js test/e2e-api.js test/unit-store-session-names.js src/web/pty-manager.js
git commit -m "feat: consolidate session names into server-persisted claudeUUID map"
```

---

## Appendix: Rollback

If the migration causes issues, the fallback in `getProjectSessionTitle` still reads from linked workspace sessions. The localStorage key is only removed after all migrations succeed. A partial rollback just requires reverting `src/web/public/app.js` — the `sessionNames` key in `workspaces.json` is additive and harmless if the frontend code is reverted.
