# Terminal Title Auto-Naming Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When Claude Code sets its terminal window title, automatically use that title as the session's display name in the Discovered section — but only when no manual name has been set.

**Architecture:** Wire xterm.js `onTitleChange` in `TerminalPane`, bubble it up to `app.js` via a callback, store auto-assigned names with a parallel `sessionNameSources` map distinguishing `'auto'` from `'manual'`, and dim auto-assigned names visually in the Discovered section.

**Tech Stack:** Node.js (store.js/server.js), vanilla JS (app.js/terminal.js), CSS custom properties via Catppuccin tokens.

---

### Task 1: Extend store with `sessionNameSources`

**Files:**
- Modify: `src/state/store.js`
- Modify: `test/unit-store-session-names.js`

**Step 1: Add `sessionNameSources` to DEFAULT_STATE**

In `store.js`, find the `DEFAULT_STATE` object (around line 34). After the `sessionNames` line, add:
```js
sessionNameSources: {}, // { [claudeUUID]: 'auto' | 'manual' }
```

**Step 2: Add it to `_parseState`**

Find the `_parseState` method (around line 121) where `sessionNames: parsed.sessionNames || {}` appears. Add directly after:
```js
sessionNameSources: parsed.sessionNameSources || {},
```

**Step 3: Update `setSessionName` to accept `source` and guard manual names**

Replace the current `setSessionName` method (lines 230–238) with:
```js
setSessionName(claudeUUID, name, source = 'manual') {
  if (!claudeUUID || typeof claudeUUID !== 'string') return null;
  if (!name || typeof name !== 'string' || name.trim() === '') return null;
  const trimmed = name.trim().slice(0, 200);
  if (!this._state.sessionNames) this._state.sessionNames = {};
  if (!this._state.sessionNameSources) this._state.sessionNameSources = {};
  // Never overwrite a manually-set name with an auto-assigned one
  if (source === 'auto' && this._state.sessionNameSources[claudeUUID] === 'manual') return null;
  this._state.sessionNames[claudeUUID] = trimmed;
  this._state.sessionNameSources[claudeUUID] = source;
  this._debouncedSave();
  return { claudeUUID, name: trimmed, source };
}
```

**Step 4: Add `getSessionNameSource` and `getAllSessionNameSources` methods**

After `getAllSessionNames()` (around line 255), add:
```js
/**
 * Get the source ('auto' | 'manual') for a stored session name.
 * @param {string} claudeUUID
 * @returns {'auto' | 'manual' | null}
 */
getSessionNameSource(claudeUUID) {
  if (!claudeUUID || typeof claudeUUID !== 'string') return null;
  return (this._state.sessionNameSources && this._state.sessionNameSources[claudeUUID]) || null;
}

/**
 * Return the entire sessionNameSources map.
 * @returns {{ [claudeUUID: string]: 'auto' | 'manual' }}
 */
getAllSessionNameSources() {
  return this._state.sessionNameSources || {};
}
```

**Step 5: Add new tests to `test/unit-store-session-names.js`**

Append after the last `check(...)` call (before the `console.log` line):
```js
// Source tracking
check('setSessionName default source is manual',
  (() => { store.setSessionName('uuid-ccc', 'Manual Name'); return store.getSessionNameSource('uuid-ccc') === 'manual'; })());

check('setSessionName with explicit auto source',
  (() => { store.setSessionName('uuid-ddd', 'Auto Name', 'auto'); return store.getSessionNameSource('uuid-ddd') === 'auto'; })());

check('auto source does not overwrite manual source',
  (() => {
    store.setSessionName('uuid-eee', 'Manual Name', 'manual');
    const result = store.setSessionName('uuid-eee', 'Auto Override', 'auto');
    return result === null && store.getSessionName('uuid-eee') === 'Manual Name';
  })());

check('manual source can overwrite auto source',
  (() => {
    store.setSessionName('uuid-fff', 'Auto Name', 'auto');
    store.setSessionName('uuid-fff', 'Manual Name', 'manual');
    return store.getSessionName('uuid-fff') === 'Manual Name' && store.getSessionNameSource('uuid-fff') === 'manual';
  })());

check('getSessionNameSource returns null for unknown UUID',
  store.getSessionNameSource('no-such-uuid') === null);

check('getAllSessionNameSources includes new entries',
  (() => {
    const sources = store.getAllSessionNameSources();
    return sources['uuid-ccc'] === 'manual' && sources['uuid-ddd'] === 'auto';
  })());
```

**Step 6: Run tests and confirm they pass**

```bash
cd /c/Projects/workbook && node test/unit-store-session-names.js
```
Expected: all checks print `PASS`, exit code 0.

**Step 7: Commit**

```bash
git add src/state/store.js test/unit-store-session-names.js
git commit -m "feat(store): add sessionNameSources tracking with auto/manual distinction"
```

---

### Task 2: Extend server API to expose sources

**Files:**
- Modify: `src/web/server.js`

**Step 1: Update `GET /api/session-names` (around line 4058)**

Change from:
```js
app.get('/api/session-names', requireAuth, (req, res) => {
  const store = getStore();
  res.json(store.getAllSessionNames());
});
```
To:
```js
app.get('/api/session-names', requireAuth, (req, res) => {
  const store = getStore();
  res.json({ names: store.getAllSessionNames(), sources: store.getAllSessionNameSources() });
});
```

**Step 2: Update `PUT /api/session-names/:claudeId` (around line 4068) to accept `source`**

Find the handler. In the body destructuring, change `const { name } = req.body || {};` to:
```js
const { name, source = 'manual' } = req.body || {};
```

Validate the source field — add after the name validation:
```js
if (source !== 'manual' && source !== 'auto') {
  return res.status(400).json({ error: "source must be 'manual' or 'auto'." });
}
```

Update the `store.setSessionName` call to pass source:
```js
const result = store.setSessionName(claudeId, name.trim(), source);
```

Update the response to include source:
```js
if (!result) return res.status(409).json({ error: 'Manual name already set; auto-assignment skipped.' });
res.json({ claudeId: result.claudeUUID, name: result.name, source: result.source });
```

> Note: `setSessionName` returns `null` when auto is blocked by manual — using 409 Conflict makes it clear it's not a server error.

**Step 3: Commit**

```bash
git add src/web/server.js
git commit -m "feat(api): expose sessionNameSources in GET, accept source param in PUT"
```

---

### Task 3: Wire `onTitleChange` in TerminalPane

**Files:**
- Modify: `src/web/public/terminal.js`

**Step 1: Find the `mount()` method**

Search for `mount()` in `terminal.js`. Locate the section where `this.term` is set up — specifically where `this.term.attachCustomKeyEventHandler` is called (around line 357), or wherever the other `this.term.on*` calls live.

**Step 2: Add the title change listener**

After the `this.term.attachCustomKeyEventHandler(...)` block, add:
```js
// Bubble terminal title changes (OSC 2 sequences set by Claude Code)
this.term.onTitleChange((title) => {
  this.onTitleChange?.(title, this.sessionId);
});
```

`onTitleChange` is a property that the app can set; it defaults to `undefined` so existing terminals without a handler are unaffected.

**Step 3: Verify manually by inspection**

No automated test for this — it fires from xterm.js events. Confirm by reading the surrounding code that `this.term` is initialized before the new line and that `this.sessionId` is set in the constructor.

**Step 4: Commit**

```bash
git add src/web/public/terminal.js
git commit -m "feat(terminal): expose onTitleChange callback from xterm.js OSC title events"
```

---

### Task 4: Update `loadSessionNames` and add client-side source helpers

**Files:**
- Modify: `src/web/public/app.js`

**Step 1: Initialize `sessionNameSources` in initial state**

Find the initial `this.state` object (around line 123) where `sessionNames: {}` is set. Add:
```js
sessionNameSources: {},
```

**Step 2: Update `loadSessionNames()` (around line 2064)**

The API now returns `{ names, sources }` instead of a flat map. Update:
```js
async loadSessionNames() {
  try {
    const data = await this.api('GET', '/api/session-names');
    if (data && typeof data === 'object') {
      this.state.sessionNames = (data.names && typeof data.names === 'object') ? data.names : (data.names === undefined ? data : {});
      this.state.sessionNameSources = (data.sources && typeof data.sources === 'object') ? data.sources : {};
    } else {
      this.state.sessionNames = {};
      this.state.sessionNameSources = {};
    }
  } catch (_) {
    this.state.sessionNames = {};
    this.state.sessionNameSources = {};
  }
```

> The `data.names === undefined ? data : {}` fallback handles the edge case where the server hasn't restarted yet and still returns a flat map — keeps backwards compat during rolling deploys.

Leave the rest of `loadSessionNames()` (the legacy localStorage migration block) unchanged.

**Step 3: Add `getSessionNameSource()` helper**

After `getProjectSessionTitle()` (around line 3467), add:
```js
/**
 * Get the name source for a Claude session UUID.
 * @param {string} claudeSessionId
 * @returns {'auto' | 'manual' | null}
 */
getSessionNameSource(claudeSessionId) {
  return (this.state.sessionNameSources && this.state.sessionNameSources[claudeSessionId]) || null;
}
```

**Step 4: Update `syncSessionTitle()` to accept and forward `source`**

Find `syncSessionTitle` (around line 3475). Update its signature and body:
```js
async syncSessionTitle(claudeSessionId, title, source = 'manual') {
  if (!claudeSessionId || !title || typeof title !== 'string' || title.trim() === '') return;
  const trimmed = title.trim();
  try {
    await this.api('PUT', `/api/session-names/${encodeURIComponent(claudeSessionId)}`, { name: trimmed, source });
    // Update local maps immediately so callers see the change without reload
    if (!this.state.sessionNames) this.state.sessionNames = {};
    if (!this.state.sessionNameSources) this.state.sessionNameSources = {};
    // Only update local state if the server would have accepted it
    // (manual never overwrites manual; auto is blocked server-side — mirror that logic)
    if (source === 'auto' && this.state.sessionNameSources[claudeSessionId] === 'manual') return;
    this.state.sessionNames[claudeSessionId] = trimmed;
    this.state.sessionNameSources[claudeSessionId] = source;
  } catch (err) {
    // 409 means server rejected auto-assign due to manual name — not an error worth toasting
    if (err.status === 409 || (err.message || '').includes('409')) return;
    this.showToast('Failed to save session name: ' + (err.message || 'unknown error'), 'error');
  }
}
```

**Step 5: Commit**

```bash
git add src/web/public/app.js
git commit -m "feat(app): update loadSessionNames and syncSessionTitle to handle name sources"
```

---

### Task 5: Wire auto-assignment in `openTerminalInPane`

**Files:**
- Modify: `src/web/public/app.js`

**Step 1: Find the `tp.onFatalError` assignment in `openTerminalInPane` (around line 8863)**

After the `tp.onFatalError = () => { ... };` block, add:
```js
// Auto-assign terminal title as session name if no name exists yet
tp.onTitleChange = async (title, sessionId) => {
  if (!title || !sessionId) return;
  if (this.getSessionNameSource(sessionId) === 'manual') return;
  await this.syncSessionTitle(sessionId, title, 'auto');
  this.renderProjects(); // Refresh Discovered section to show updated name
};
```

**Step 2: Verify by inspection**

Confirm `tp.onTitleChange` is not already set elsewhere in `openTerminalInPane`. Confirm `this.renderProjects` is a method on the app class.

**Step 3: Commit**

```bash
git add src/web/public/app.js
git commit -m "feat(app): auto-assign terminal title as session name when unnamed"
```

---

### Task 6: Visual distinction in Discovered section

**Files:**
- Modify: `src/web/public/app.js`
- Modify: `src/web/public/styles.css`

**Step 1: Add `session-name-auto` class to session name span in Discovered renderer**

Find the session item builder around line 8354. Locate this line:
```js
const storedTitle = this.getProjectSessionTitle(sessName);
```

After it, add:
```js
const isAutoName = storedTitle && this.getSessionNameSource(sessName) === 'auto';
```

Then find the `<span class="project-session-name">` element (around line 8367):
```js
<span class="project-session-name">${this.escapeHtml(displayName)}</span>
```

Change to:
```js
<span class="project-session-name${isAutoName ? ' session-name-auto' : ''}">${this.escapeHtml(displayName)}</span>
```

**Step 2: Add CSS for auto-assigned names**

In `styles.css`, find line 3754:
```css
.project-session-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
```

Add directly after:
```css
.project-session-name.session-name-auto { color: var(--subtext0); }
```

**Step 3: Commit**

```bash
git add src/web/public/app.js src/web/public/styles.css
git commit -m "feat(discovered): dim auto-assigned session names with subtext0 color"
```

---

### Task 7: End-to-end smoke test

**Manual verification steps:**

1. Start the server: `node src/index.js` (or however the dev server is started)
2. Open the UI in a browser
3. In the Discovered section, find a session that has no assigned name (shows as truncated UUID)
4. Open that session in a terminal pane
5. Wait for Claude Code to set its terminal title (it does this on startup — should be near-instant)
6. Verify: the session's display name in Discovered updates to the title Claude set, shown in a slightly dimmer color
7. Right-click the session → Rename → set a manual name
8. Trigger another title change from Claude (e.g., `/clear` to start fresh — note: per existing behaviour, this will reset the UUID mapping, so use a long-running session instead). Or simply check that the `getSessionNameSource` returns `'manual'` via the API: `GET /api/session-names` should show the UUID under `sources` as `'manual'`
9. Verify the manual name is NOT overwritten when Claude sets a new title

**Step: Commit any fixes found during testing**

```bash
git add -p
git commit -m "fix: <description of what needed fixing>"
```
