# Project-Context New Session Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Pre-fill the New Session modal with project name and default directory when creating sessions from the Discovered Projects panel.

**Architecture:** Three layers — store schema + methods, REST API endpoints, frontend state tracking + UI. Each layer is independently testable. The frontend tracks `activeProjectContext` when a project header is clicked, and each project accordion header gets an inline `+` button that passes context directly.

**Tech Stack:** Node.js/Express (server.js), vanilla JS SPA (app.js), CSS (styles.css), JSON state store (store.js). Tests use the existing `test/e2e-api.js` pattern (raw HTTP, no test framework).

---

### Task 1: Store — Add `projectDefaults` schema and methods

**Files:**
- Modify: `src/state/store.js:22-39` (DEFAULT_STATE)
- Modify: `src/state/store.js:180-200` (after getters section)
- Modify: `src/state/store.js:101-119` (_tryLoadFile)

**Step 1: Add `projectDefaults` to DEFAULT_STATE**

In `src/state/store.js`, find `DEFAULT_STATE` (line 22). Add the new key after `worktreeTasks`:

```js
// Before (line 32):
  worktreeTasks: {},

// After:
  worktreeTasks: {},
  projectDefaults: {},   // { [encodedName]: { defaultDir: string } }
```

**Step 2: Add `projectDefaults` to `_tryLoadFile` merge**

Find the `return { ...DEFAULT_STATE, ...parsed, ... }` block in `_tryLoadFile` (~line 108). Add:

```js
// Add alongside worktreeTasks, features, etc.:
projectDefaults: parsed.projectDefaults || {},
```

**Step 3: Add store methods after the getters section (~line 200)**

Add these two methods:

```js
// ─── Project Defaults ────────────────────────────────────

getProjectDefaults() {
  return this._state.projectDefaults || {};
}

setProjectDefault(encodedName, { defaultDir }) {
  if (!encodedName || typeof encodedName !== 'string') return null;
  if (!this._state.projectDefaults) this._state.projectDefaults = {};
  this._state.projectDefaults[encodedName] = { defaultDir: defaultDir || '' };
  this._debouncedSave();
  return this._state.projectDefaults[encodedName];
}
```

**Step 4: Verify the store loads/saves correctly by inspecting the structure**

Run:
```bash
node -e "const s = require('./src/state/store'); s.init(); console.log('projectDefaults' in s.state);"
```
Expected output: `true`

**Step 5: Commit**

```bash
git add src/state/store.js
git commit -m "feat: add projectDefaults to store schema and CRUD methods"
```

---

### Task 2: Server — Add `GET` and `PUT` API endpoints

**Files:**
- Modify: `src/web/server.js` — add two routes near the `/api/templates` block

**Step 1: Find a good insertion point**

Search for `app.get('/api/templates'` in `server.js`. Add the new routes directly before it.

**Step 2: Add the routes**

```js
// ─── Project Defaults ───────────────────────────────────

app.get('/api/project-defaults', requireAuth, (req, res) => {
  const store = getStore();
  res.json(store.getProjectDefaults());
});

app.put('/api/project-defaults/:encodedName', requireAuth, (req, res) => {
  const { encodedName } = req.params;
  const { defaultDir } = req.body || {};
  if (!encodedName) return res.status(400).json({ error: 'encodedName required.' });
  const sanitized = sanitizeWorkingDir(defaultDir);
  // Allow empty string to clear the default dir
  const dirToStore = defaultDir === '' ? '' : (sanitized || '');
  const store = getStore();
  const result = store.setProjectDefault(encodedName, { defaultDir: dirToStore });
  res.json({ success: true, projectDefault: result });
});
```

**Step 3: Add API tests to `test/e2e-api.js`**

Find the end of the existing test sections (look for the final `check(` calls before `run()`). Add a new section:

```js
// ════════════════════════════════════════
// PROJECT DEFAULTS
// ════════════════════════════════════════
console.log('\n--- Project Defaults ---');

r = await get('/api/project-defaults');
check('GET /api/project-defaults returns object', r.status === 200 && typeof json(r) === 'object');

r = await put('/api/project-defaults/test-encoded-name', { defaultDir: 'C:/Projects/test' });
check('PUT /api/project-defaults sets defaultDir', r.status === 200 && json(r)?.success === true);

r = await get('/api/project-defaults');
check('GET /api/project-defaults contains saved entry', json(r)?.['test-encoded-name']?.defaultDir === 'C:/Projects/test');

r = await put('/api/project-defaults/test-encoded-name', { defaultDir: '' });
check('PUT /api/project-defaults can clear defaultDir', r.status === 200 && json(r)?.success === true);
```

**Step 4: Run the tests**

Start the server in one terminal:
```bash
CWM_PASSWORD=test123 PORT=3458 node src/web/server.js
```

In another terminal:
```bash
CWM_PASSWORD=test123 PORT=3458 node test/e2e-api.js 2>&1 | grep -A2 "Project Defaults"
```
Expected: 4 PASS lines for the project defaults section.

**Step 5: Commit**

```bash
git add src/web/server.js test/e2e-api.js
git commit -m "feat: add GET/PUT /api/project-defaults endpoints"
```

---

### Task 3: Frontend — State, init, load project defaults

**Files:**
- Modify: `src/web/public/app.js` — state object and `loadAll()`

**Step 1: Add `projectDefaults` and `activeProjectContext` to state**

Find the state object initialization (~line 98-134, look for `hiddenProjects`). Add alongside it:

```js
// Add after hiddenProjects line:
projectDefaults: {},          // { [encodedName]: { defaultDir } } — loaded from server
activeProjectContext: null,   // { name, realPath, encodedName, defaultDir } — set on project click
```

**Step 2: Add `loadProjectDefaults()` method**

Find `loadProjects()` method (~line 8040). Add a new method directly after it:

```js
async loadProjectDefaults() {
  try {
    const data = await this.api('GET', '/api/project-defaults');
    this.state.projectDefaults = data || {};
  } catch {
    // Non-critical
  }
}
```

**Step 3: Call `loadProjectDefaults()` in `loadAll()`**

Find the `Promise.all([...])` block in `loadAll()` (~line 1975):

```js
// Before:
await Promise.all([
  this.loadWorkspaces(),
  this.loadStats(),
  this.loadGroups(),
  this.loadProjects(),
]);

// After:
await Promise.all([
  this.loadWorkspaces(),
  this.loadStats(),
  this.loadGroups(),
  this.loadProjects(),
  this.loadProjectDefaults(),
]);
```

**Step 4: Verify by opening the app and checking browser console**

Open dev tools → Console, type:
```js
app.state.projectDefaults
```
Expected: `{}` (empty object, not undefined/null).

**Step 5: Commit**

```bash
git add src/web/public/app.js
git commit -m "feat: load projectDefaults from server on app init"
```

---

### Task 4: Frontend — Modify `createSession(opts = {})` to accept pre-fills

**Files:**
- Modify: `src/web/public/app.js` — `createSession()` method (~line 2298)

**Step 1: Change the method signature**

```js
// Before:
async createSession() {

// After:
async createSession(opts = {}) {
```

**Step 2: Pre-fill the Name field**

Find the `fields` array definition (~line 2306). Change the `name` field:

```js
// Before:
{ key: 'name', label: 'Name', placeholder: 'feature-auth', required: true },

// After:
{ key: 'name', label: 'Name', placeholder: 'feature-auth', required: true, value: opts.name || '' },
```

**Step 3: Pre-fill the Working Directory field**

Change the `workingDir` field:

```js
// Before:
{ key: 'workingDir', label: 'Working Directory', placeholder: '~/projects/my-app' },

// After:
{ key: 'workingDir', label: 'Working Directory', placeholder: '~/projects/my-app', value: opts.workingDir || '' },
```

**Step 4: Clear `activeProjectContext` after the modal resolves**

Find the line after `const result = await resultPromise;` (~line 2360). Add:

```js
const result = await resultPromise;
this.state.activeProjectContext = null; // Clear after use

if (!result) return;
```

**Step 5: Update the `#create-session-btn` click handler to pass context**

Find the click handler (~line 632):

```js
// Before:
this.els.createSessionBtn.addEventListener('click', () => this.createSession());

// After:
this.els.createSessionBtn.addEventListener('click', () => {
  const ctx = this.state.activeProjectContext;
  this.createSession(ctx ? { name: ctx.name, workingDir: ctx.defaultDir || '' } : {});
});
```

**Step 6: Manually test in browser**

1. Open the app, click a project header in the sidebar
2. Click the global "New" button
3. Verify Name and Working Dir are pre-filled from the project

**Step 7: Commit**

```bash
git add src/web/public/app.js
git commit -m "feat: createSession accepts pre-fill opts; global button reads activeProjectContext"
```

---

### Task 5: Frontend — Track `activeProjectContext` on project header click

**Files:**
- Modify: `src/web/public/app.js` — event delegation in `renderProjects()` or the accordion click handler

**Step 1: Find where project accordion header clicks are handled**

Search for `project-accordion-header` click handling in `app.js`. It will be near the `setupProjectsListEvents` or inside a delegated listener on `#projects-list`.

**Step 2: In the accordion header click handler, set `activeProjectContext`**

The header click currently toggles expand/collapse. Extend it to also update context. Find the handler and add:

```js
// When a project accordion header is clicked, track it as active context
const encoded = accordionEl.dataset.encoded;
const projectPath = accordionEl.dataset.path;
const projectName = accordionEl.querySelector('.project-name')?.textContent?.trim() || encoded;
const defaultDir = (this.state.projectDefaults[encoded] || {}).defaultDir || '';

this.state.activeProjectContext = {
  name: projectName,
  realPath: projectPath,
  encodedName: encoded,
  defaultDir,
};
```

**Step 3: Verify via browser console**

Click a project header, then run:
```js
app.state.activeProjectContext
```
Expected: object with `name`, `realPath`, `encodedName`, `defaultDir` properties.

**Step 4: Commit**

```bash
git add src/web/public/app.js
git commit -m "feat: track activeProjectContext when project header is clicked"
```

---

### Task 6: Frontend — Per-project `+` button in accordion headers

**Files:**
- Modify: `src/web/public/app.js` — `renderProjects()` (~line 8152)
- Modify: `src/web/public/styles.css` — new `.project-new-session-btn` rules

**Step 1: Add the `+` button to the accordion header HTML**

In `renderProjects()`, find the template string that builds `.project-accordion-header` (~line 8153):

```js
// Before:
return `<div class="project-accordion${missingClass}${hiddenClass}" data-encoded="${this.escapeHtml(encoded)}" data-path="${this.escapeHtml(p.realPath || '')}">
  <div class="project-accordion-header" draggable="${p.dirExists ? 'true' : 'false'}">
    <span class="project-accordion-chevron">&#9654;</span>
    <span class="project-name" title="${this.escapeHtml(p.realPath || '')}">${this.escapeHtml(name)}</span>
    <span class="project-session-count">${sessions.length}</span>
    ${sizeStr ? `<span class="project-size">${sizeStr}</span>` : ''}
  </div>

// After:
return `<div class="project-accordion${missingClass}${hiddenClass}" data-encoded="${this.escapeHtml(encoded)}" data-path="${this.escapeHtml(p.realPath || '')}">
  <div class="project-accordion-header" draggable="${p.dirExists ? 'true' : 'false'}">
    <span class="project-accordion-chevron">&#9654;</span>
    <span class="project-name" title="${this.escapeHtml(p.realPath || '')}">${this.escapeHtml(name)}</span>
    <span class="project-session-count">${sessions.length}</span>
    ${sizeStr ? `<span class="project-size">${sizeStr}</span>` : ''}
    <button class="project-new-session-btn" data-encoded="${this.escapeHtml(encoded)}" data-path="${this.escapeHtml(p.realPath || '')}" data-name="${this.escapeHtml(name)}" title="New session in this project" tabindex="-1">&#43;</button>
  </div>
```

**Step 2: Add CSS for the `+` button**

In `styles.css`, find the `.project-accordion-header` block (~line 3704). Add after:

```css
/* Per-project new session button */
.project-new-session-btn {
  display: none;
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1;
  padding: 0 2px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  flex-shrink: 0;
  margin-left: auto;
}
.project-accordion-header:hover .project-new-session-btn {
  display: block;
}
.project-new-session-btn:hover {
  color: var(--text-primary);
  background: var(--surface1);
}
```

**Step 3: Wire up the `+` button click via event delegation**

Find the delegated click listener on `#projects-list` (or wherever project accordion click handling is set up). Add a handler for `.project-new-session-btn`:

```js
// Inside the projects-list click delegation:
const newSessionBtn = e.target.closest('.project-new-session-btn');
if (newSessionBtn) {
  e.stopPropagation(); // Don't toggle accordion
  const encoded = newSessionBtn.dataset.encoded;
  const projectPath = newSessionBtn.dataset.path;
  const projectName = newSessionBtn.dataset.name || encoded;
  const defaultDir = (this.state.projectDefaults[encoded] || {}).defaultDir || '';
  this.createSession({ name: projectName, workingDir: defaultDir });
  return;
}
```

**Step 4: Test in browser**

1. Hover over a project header in the sidebar
2. Verify the `+` button appears
3. Click it — verify the New Session modal opens with project name pre-filled
4. Check that clicking the `+` does NOT toggle the accordion

**Step 5: Commit**

```bash
git add src/web/public/app.js src/web/public/styles.css
git commit -m "feat: add per-project + button to accordion headers with pre-filled modal"
```

---

### Task 7: Frontend — "Set Default Directory" in project context menu

**Files:**
- Modify: `src/web/public/app.js` — `showProjectContextMenu()` (~line 3038)

**Step 1: Find the context menu method and add a new item**

Find `showProjectContextMenu(encodedName, displayName, projectPath, x, y)` (~line 3038). After the "Copy Path" item block (~line 3075), add:

```js
items.push({ type: 'sep' });

// Set default directory for new sessions
const currentDefault = (this.state.projectDefaults[encodedName] || {}).defaultDir || '';
items.push({
  label: currentDefault ? `Default Dir: ${currentDefault.split(/[/\\]/).pop()}` : 'Set Default Directory',
  icon: '&#128194;',
  action: async () => {
    const result = await this.showPromptModal({
      title: `Default Directory — ${displayName}`,
      fields: [
        {
          key: 'defaultDir',
          label: 'Working Directory',
          placeholder: projectPath || '~/projects/my-app',
          value: currentDefault,
        },
      ],
      confirmText: 'Save',
      confirmClass: 'btn-primary',
    });
    if (result === null) return; // cancelled
    const dir = result.defaultDir || '';
    // Inject browse button before modal resolves (same pattern as createSession)
    try {
      await this.api('PUT', `/api/project-defaults/${encodeURIComponent(encodedName)}`, { defaultDir: dir });
      this.state.projectDefaults[encodedName] = { defaultDir: dir };
      this.showToast(dir ? `Default dir set for "${displayName}"` : `Default dir cleared for "${displayName}"`, 'success');
    } catch (err) {
      this.showToast(err.message || 'Failed to save default directory', 'error');
    }
  },
});
```

**Step 2: Also inject the browse button for this modal**

The `showPromptModal` call needs the browse button. Wrap it like `createSession` does:

```js
const resultPromise = this.showPromptModal({ ... });
requestAnimationFrame(() => this._injectBrowseButton('modal-field-defaultDir'));
const result = await resultPromise;
```

Refactor the action above to use this pattern.

**Step 3: Test in browser**

1. Right-click a project header
2. Verify "Set Default Directory" appears in the menu (with current dir if already set)
3. Click it, enter a path, click Save
4. Right-click again — verify the label updates to show the last folder of the saved path
5. Click `+` button or global New — verify Working Dir is pre-filled with the saved default

**Step 4: Commit**

```bash
git add src/web/public/app.js
git commit -m "feat: add Set Default Directory to project context menu"
```

---

### Task 8: Final integration test

**Step 1: Full manual smoke test**

1. Start the server: `node src/supervisor.js` (or `npm run gui`)
2. Open browser, navigate to the app
3. **Per-project + button:**
   - Hover a project → `+` appears
   - Click `+` → modal opens with project name in Name field, Working Dir empty
4. **Set Default Directory:**
   - Right-click project → "Set Default Directory" → enter a path → Save
   - Click `+` again → modal opens with project name AND the saved working dir
5. **Global button with context:**
   - Click project header (accordion click) → header highlights
   - Click global "New" button in session list panel → modal pre-fills from that project
   - Submit or cancel → `activeProjectContext` clears
6. **Clear default dir:**
   - Right-click → "Set Default Directory" → clear field → Save
   - Click `+` → Working Dir is empty again

**Step 2: Run existing API tests to confirm no regressions**

```bash
CWM_PASSWORD=test123 PORT=3458 node src/web/server.js &
sleep 2
CWM_PASSWORD=test123 PORT=3458 node test/e2e-api.js
```
Expected: all previous tests still PASS, plus 4 new project-defaults tests PASS.

**Step 3: Final commit if any cleanup needed**

```bash
git add -p
git commit -m "fix: integration cleanup for project-context new session"
```
