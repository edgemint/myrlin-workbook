# Discovered Sessions Active-State Tracking Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show a ✓ checkmark on discovered session items that are already open in a terminal pane, and redirect focus to the existing pane when the user clicks or drops an already-open session.

**Architecture:** All changes are frontend-only in `app.js` and `styles.css`. Two new helpers (`getActiveTerminalSessionIds`, `focusPaneBySessionId`) read from the already-tracked `this.terminalPanes` array and `this._groupPaneCache` map — no new server state. The `renderProjects()` render loop, the `projList` click handler, and the terminal-pane drop handler are each updated to use these helpers.

**Tech Stack:** Vanilla JS, CSS custom properties (Catppuccin Mocha theme vars). No new dependencies.

---

### Task 1: Add `getActiveTerminalSessionIds()` helper

**Files:**
- Modify: `src/web/public/app.js` — add method after `openTerminalInPane` (around line 8900+)

**Step 1: Locate the insertion point**

Find the line in `app.js` where `openTerminalInPane` ends (search for `openTerminalInPane` then scroll past it). The new method goes right after. Run:
```bash
grep -n "openTerminalInPane" src/web/public/app.js | tail -5
```
Note the line number where the method body ends (the closing `}`).

**Step 2: Insert the helper method**

Add immediately after the closing `}` of `openTerminalInPane`:

```js
  /**
   * Returns a Set of all sessionIds currently open in any terminal pane,
   * across the active tab group and all cached (non-active) tab groups.
   */
  getActiveTerminalSessionIds() {
    const ids = new Set();
    for (const tp of this.terminalPanes) {
      if (tp) ids.add(tp.sessionId);
    }
    for (const cached of Object.values(this._groupPaneCache || {})) {
      for (const pane of (cached.panes || [])) {
        if (pane) ids.add(pane.sessionId);
      }
    }
    return ids;
  }
```

**Step 3: Verify syntax (no test needed — trivial helper)**

Start the server and load the UI. Open the browser console and run:
```js
cwm.getActiveTerminalSessionIds()
```
Expected: a `Set {}` (possibly empty if no panes are open, or a Set with session IDs if panes are open).

**Step 4: Commit**
```bash
git add src/web/public/app.js
git commit -m "feat(discovered): add getActiveTerminalSessionIds helper"
```

---

### Task 2: Add `focusPaneBySessionId()` helper

**Files:**
- Modify: `src/web/public/app.js` — add method right after `getActiveTerminalSessionIds`

**Step 1: Insert the helper**

Add immediately after the closing `}` of `getActiveTerminalSessionIds`:

```js
  /**
   * Finds a terminal pane by Claude session ID and focuses it.
   * Checks the active group first, then cached groups (switching if needed).
   * Also switches the view to 'terminal' so the pane is visible.
   * @returns {boolean} true if found and focused, false if not open anywhere
   */
  focusPaneBySessionId(claudeId) {
    // Check active group
    for (let i = 0; i < this.terminalPanes.length; i++) {
      if (this.terminalPanes[i] && this.terminalPanes[i].sessionId === claudeId) {
        this.setViewMode('terminal');
        this.setActiveTerminalPane(i);
        return true;
      }
    }
    // Check cached (non-active) groups
    for (const [groupId, cached] of Object.entries(this._groupPaneCache || {})) {
      const panes = cached.panes || [];
      for (let i = 0; i < panes.length; i++) {
        if (panes[i] && panes[i].sessionId === claudeId) {
          this.setViewMode('terminal');
          this.switchTerminalGroup(groupId);
          // Give switchTerminalGroup time to restore panes before focusing
          setTimeout(() => this.setActiveTerminalPane(i), 50);
          return true;
        }
      }
    }
    return false;
  }
```

**Step 2: Smoke-test in console**

Open a discovered session manually (drag it into a pane). Then in the browser console:
```js
// Should return true and focus the pane
cwm.focusPaneBySessionId('<the-session-uuid-you-just-opened>')
// Should return false (not open)
cwm.focusPaneBySessionId('nonexistent-session-id')
```
Expected: first call returns `true` and the pane becomes focused; second returns `false`.

**Step 3: Commit**
```bash
git add src/web/public/app.js
git commit -m "feat(discovered): add focusPaneBySessionId helper"
```

---

### Task 3: Add CSS for active-session indicator

**Files:**
- Modify: `src/web/public/styles.css` — edit the `.project-session-item` block (around line 3747)

**Step 1: Locate the block**

```bash
grep -n "project-session-item" src/web/public/styles.css
```

**Step 2: Add new rules after `.project-session-item.dragging`**

Find the line `.project-session-item.dragging { opacity: 0.4; }` and add after it:

```css
.project-session-item.project-session-open { cursor: pointer; }
.project-session-active-icon {
  color: var(--green);
  font-size: 10px;
  font-weight: bold;
  flex-shrink: 0;
  line-height: 1;
}
```

**Step 3: Commit**
```bash
git add src/web/public/styles.css
git commit -m "feat(discovered): add CSS for active-session checkmark indicator"
```

---

### Task 4: Mark active sessions in `renderProjects()`

**Files:**
- Modify: `src/web/public/app.js` — edit `renderProjects()` method (around line 8268)

**Step 1: Locate `renderProjects()`**

```bash
grep -n "renderProjects()" src/web/public/app.js | head -5
```

Find the line where the method body starts (after `renderProjects() {`).

**Step 2: Add `activeIds` at the top of the method**

Right after the `renderProjects() {` opening line, add:

```js
    const activeIds = this.getActiveTerminalSessionIds();
```

(It goes before the `const list = this.els.projectsList;` line.)

**Step 3: Update the session item template**

In `renderProjects()`, find the `sessionItems` map block that builds each item's HTML:

```js
        return `<div class="project-session-item" draggable="true" data-session-name=...
```

Replace it with:

```js
        const isOpen = activeIds.has(sessName);
        return `<div class="project-session-item${isOpen ? ' project-session-open' : ''}" draggable="true" data-session-name="${this.escapeHtml(sessName)}" data-project-path="${this.escapeHtml(p.realPath || '')}" data-project-encoded="${this.escapeHtml(encoded)}" title="${this.escapeHtml(tooltip)}">
          ${isOpen ? '<span class="project-session-active-icon">&#10003;</span>' : ''}
          <span class="project-session-name">${this.escapeHtml(displayName)}</span>
          ${sessSize ? `<span class="project-session-size">${sessSize}</span>` : ''}
          ${sessTime ? `<span class="project-session-time">${sessTime}</span>` : ''}
        </div>`;
```

**Step 4: Verify visually**

Open the UI, open a discovered session by dragging it into a pane, then look at the Discovered panel. The session should show a green ✓ to the left of the name.

**Step 5: Commit**
```bash
git add src/web/public/app.js
git commit -m "feat(discovered): show checkmark on sessions already open in a pane"
```

---

### Task 5: Click handler — focus or open session

**Files:**
- Modify: `src/web/public/app.js` — edit `projList.addEventListener('click', ...)` (around line 1719)

**Step 1: Locate the click handler**

```bash
grep -n "projList.addEventListener('click'" src/web/public/app.js
```

**Step 2: Add session-item click handling**

Inside the click handler, BEFORE the `const header = e.target.closest('.project-accordion-header')` line, add:

```js
        const sessionItem = e.target.closest('.project-session-item');
        if (sessionItem) {
          e.stopPropagation();
          const sessName = sessionItem.dataset.sessionName;
          const projectPath = sessionItem.dataset.projectPath;
          // Already open → redirect focus
          if (this.focusPaneBySessionId(sessName)) {
            this.showToast('Focused existing session', 'info');
            return;
          }
          // Not open → open in next empty pane
          const emptySlot = this.terminalPanes.findIndex(p => p === null);
          if (emptySlot !== -1) {
            this.openTerminalInPane(emptySlot, sessName, sessName, {
              cwd: projectPath,
              resumeSessionId: sessName,
              command: 'claude',
            });
            this.setViewMode('terminal');
          } else {
            this.showToast('All panes are occupied — close one first', 'warning');
          }
          return;
        }
```

**Step 3: Also remove the early-return guard that blocked session-item clicks**

Find this existing line inside the header block:
```js
          if (e.target.closest('.project-session-item')) return;
```
This guard was preventing session-item clicks from being handled when the item is inside the header area. Now that we handle session-item clicks above (and `return` early), this guard is harmless but can be removed for clarity. Remove it.

**Step 4: Verify click behavior**

- Click a discovered session that is NOT open → should open in terminal view
- Click a discovered session that IS open → should show toast and focus the pane
- Click an accordion header (not a session item) → should still expand/collapse correctly

**Step 5: Commit**
```bash
git add src/web/public/app.js
git commit -m "feat(discovered): click session to open or focus existing pane"
```

---

### Task 6: Intercept drag-drop for already-open sessions

**Files:**
- Modify: `src/web/public/app.js` — edit the `cwm/project-session` drop handler inside the terminal-pane drop listener (around line 8601)

**Step 1: Locate the drop handler**

```bash
grep -n "Project-session drop" src/web/public/app.js
```

Find the block that starts with:
```js
          // Drop a project-session (individual .jsonl from project accordion) into terminal pane
          const projSessJson = e.dataTransfer.getData('cwm/project-session');
          if (projSessJson) {
            try {
              const ps = JSON.parse(projSessJson);
              const claudeSessionId = ps.sessionName;
```

**Step 2: Add the focus-redirect before the `openTerminalInPane` call**

After `const claudeSessionId = ps.sessionName;`, add:

```js
              // If already open anywhere, redirect focus instead of spawning duplicate
              if (this.focusPaneBySessionId(claudeSessionId)) {
                this.showToast('Session already open — focused existing pane', 'info');
                return;
              }
```

**Step 3: Verify drag-drop behavior**

- Drag a session that is NOT open → opens in the target pane (existing behavior)
- Drag a session that IS open → shows toast, focuses existing pane, does NOT open a duplicate

**Step 4: Commit**
```bash
git add src/web/public/app.js
git commit -m "feat(discovered): redirect drag-drop to existing pane if already open"
```

---

### Task 7: Final verification

**Step 1: Run the API test suite to confirm no regressions**
```bash
CWM_PASSWORD=test123 PORT=3458 node test/e2e-api.js
```
Expected: all tests pass (these are server-side API tests unaffected by frontend changes).

**Step 2: Manual browser checklist**

Open the UI and verify all of the following:

- [ ] Open a discovered session by dragging → ✓ checkmark appears on it in Discovered panel
- [ ] Click the same session again → toast "Focused existing session", terminal view opens/focuses to that pane
- [ ] Click a different (non-open) session → opens in next empty pane, switches to terminal view
- [ ] Drag an already-open session onto a terminal pane → toast "Session already open", redirects to existing pane
- [ ] Close the pane → ✓ checkmark disappears on next `renderProjects()` call (happens automatically on next re-render)
- [ ] Open session in tab group 2, switch to tab group 1, click session in Discovered → switches to group 2 and focuses it

**Step 3: Commit final**
```bash
git add -A
git commit -m "feat(discovered): active-session tracking complete"
```
