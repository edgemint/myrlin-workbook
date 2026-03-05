# Folder Group Drag-to-Workspace Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make workspace folder groups (sessions grouped by workingDir) draggable to other workspaces.

**Architecture:** Extend the existing event-delegation DnD system on `wsList`. A new `cwm/project-group` drag type carries `{ dir, wsId }`. On drop, a new `moveFolderGroupToWorkspace` method iterates matching sessions and calls the existing `moveSessionToWorkspace` for each. No new CSS needed — existing `.dragging` and `.workspace-drop-target` styles apply automatically.

**Tech Stack:** Vanilla JS, HTML drag-and-drop API, existing `/api/sessions/:id` PUT endpoint.

---

### Task 1: Make group headers draggable in the render function

**Files:**
- Modify: `src/web/public/app.js` ~line 7799 (the `ws-project-group-header` div in `renderWorkspaceList`)

**Step 1: Find the exact line**

Search for `ws-project-group-header` in `app.js`. It will be inside a template literal that builds the group HTML. The current line looks like:

```js
<div class="ws-project-group-header" data-dir="${...}" data-ws-id="${ws.id}" title="${...}">
```

**Step 2: Add `draggable="true"`**

Change it to:

```js
<div class="ws-project-group-header" draggable="true" data-dir="${this.escapeHtml(dir)}" data-ws-id="${ws.id}" title="${this.escapeHtml(dir)}">
```

**Step 3: Manually verify**

Open the app, expand a workspace with multiple directories. Hover over a folder group header — the cursor should change to a grab cursor (browsers do this automatically for `draggable="true"` elements). You can start dragging it but it won't do anything yet.

**Step 4: Commit**

```bash
git add src/web/public/app.js
git commit -m "feat: make ws-project-group-header draggable"
```

---

### Task 2: Handle dragstart for group header

**Files:**
- Modify: `src/web/public/app.js` ~line 1547 (`dragstart` listener on `wsList`)

**Step 1: Find the dragstart handler**

Search for `wsList.addEventListener('dragstart'`. The handler currently checks for `.ws-session-item` then `.workspace-item`. Add a new branch BEFORE the `.workspace-item` check (group headers are inside workspace items, so the `.workspace-item` check would fire instead without this early return).

**Step 2: Insert the branch**

Add this block after the `wsSessionItem` branch and before the `workspaceItem` branch:

```js
const projectGroupHeader = e.target.closest('.ws-project-group-header');
if (projectGroupHeader) {
  const dir = projectGroupHeader.dataset.dir;
  const wsId = projectGroupHeader.dataset.wsId;
  e.dataTransfer.setData('cwm/project-group', JSON.stringify({ dir, wsId }));
  e.dataTransfer.effectAllowed = 'move';
  projectGroupHeader.closest('.ws-project-group').classList.add('dragging');
  return;
}
```

**Step 3: Extend the dragend cleanup**

Find `wsList.addEventListener('dragend'`. It currently does:

```js
const el = e.target.closest('.ws-session-item, .workspace-item');
if (el) el.classList.remove('dragging');
```

Change the selector to also cover project groups:

```js
const el = e.target.closest('.ws-session-item, .workspace-item, .ws-project-group');
if (el) el.classList.remove('dragging');
```

**Step 4: Manually verify**

Drag a folder group header — the entire group row should fade to 0.4 opacity (the global `.dragging` rule in `styles.css` line 3917 handles this). Release anywhere — opacity restores.

**Step 5: Commit**

```bash
git add src/web/public/app.js
git commit -m "feat: emit cwm/project-group on drag, cleanup on dragend"
```

---

### Task 3: Accept the drop type in dragover

**Files:**
- Modify: `src/web/public/app.js` ~line 1573 (`dragover` listener on `wsList`)

**Step 1: Find the dragover handler**

Search for `wsList.addEventListener('dragover'`. Inside the `workspaceItem` branch there are already checks for `cwm/session`, `cwm/workspace`, `cwm/project`, and `cwm/project-session`.

**Step 2: Add the new check**

Add this alongside the existing type checks inside the `if (workspaceItem)` block:

```js
} else if (e.dataTransfer.types.includes('cwm/project-group')) {
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  workspaceItem.classList.add('workspace-drop-target');
}
```

**Step 3: Manually verify**

Drag a folder group header over another workspace item — it should highlight with the blue border (`.workspace-drop-target` style, `styles.css` line 1138). Move away — highlight clears (the existing `dragleave` handler already removes `workspace-drop-target`).

**Step 4: Commit**

```bash
git add src/web/public/app.js
git commit -m "feat: accept cwm/project-group in dragover on workspace items"
```

---

### Task 4: Add moveFolderGroupToWorkspace method

**Files:**
- Modify: `src/web/public/app.js` — add new method near `moveSessionToWorkspace` (~line 2718)

**Step 1: Insert the method**

Add this directly after the closing brace of `moveSessionToWorkspace`:

```js
async moveFolderGroupToWorkspace(dir, srcWsId, targetWsId) {
  if (srcWsId === targetWsId) return;
  const all = this.state.allSessions || this.state.sessions;
  const sessions = all.filter(s => s.workspaceId === srcWsId && s.workingDir === dir);
  if (sessions.length === 0) return;
  const targetWs = this.state.workspaces.find(w => w.id === targetWsId);
  for (const s of sessions) {
    await this.moveSessionToWorkspace(s.id, targetWsId);
  }
  this.showToast(`Moved ${sessions.length} session${sessions.length !== 1 ? 's' : ''} to "${targetWs ? targetWs.name : targetWsId}"`, 'success');
}
```

Note: `moveSessionToWorkspace` already calls `renderWorkspaces()` and `renderSessions()` on each call, and shows its own per-session toast. To avoid N toasts, we need to suppress them. Look at `moveSessionToWorkspace` — it calls `this.showToast(...)` at the end. Either:
- Call the underlying API directly in the loop and show one consolidated toast, OR
- Keep it simple and accept N toasts for N sessions (acceptable for now)

For simplicity, call the API directly in the loop and do one render + one toast at the end:

```js
async moveFolderGroupToWorkspace(dir, srcWsId, targetWsId) {
  if (srcWsId === targetWsId) return;
  const all = this.state.allSessions || this.state.sessions;
  const sessions = all.filter(s => s.workspaceId === srcWsId && s.workingDir === dir);
  if (sessions.length === 0) return;
  const targetWs = this.state.workspaces.find(w => w.id === targetWsId);

  try {
    for (const s of sessions) {
      await this.api('PUT', `/api/sessions/${s.id}`, { workspaceId: targetWsId });
      s.workspaceId = targetWsId;
      const allSession = this.state.allSessions && this.state.allSessions.find(a => a.id === s.id);
      if (allSession && allSession !== s) allSession.workspaceId = targetWsId;
    }
    this.renderWorkspaces();
    this.renderSessions();
    this.showToast(`Moved ${sessions.length} session${sessions.length !== 1 ? 's' : ''} to "${targetWs ? targetWs.name : 'workspace'}"`, 'success');
  } catch (err) {
    this.showToast('Failed to move sessions: ' + (err.message || ''), 'error');
  }
}
```

**Step 2: Commit**

```bash
git add src/web/public/app.js
git commit -m "feat: add moveFolderGroupToWorkspace method"
```

---

### Task 5: Handle the drop event

**Files:**
- Modify: `src/web/public/app.js` ~line 1614 (`drop` listener on `wsList`)

**Step 1: Find the drop handler**

Search for `wsList.addEventListener('drop'`. Inside the `if (workspaceItem)` block, there are branches for `cwm/session`, `cwm/project-session`, `cwm/project`, and `cwm/workspace`.

**Step 2: Add the cwm/project-group branch**

Add this as the FIRST check inside the `if (workspaceItem)` block (before the `cwm/session` check, to be explicit):

```js
// Folder group move to workspace
const projectGroupJson = e.dataTransfer.getData('cwm/project-group');
if (projectGroupJson) {
  e.preventDefault(); e.stopPropagation();
  try {
    const { dir, wsId } = JSON.parse(projectGroupJson);
    await this.moveFolderGroupToWorkspace(dir, wsId, targetWsId);
  } catch (err) {
    this.showToast('Failed to move folder: ' + (err.message || ''), 'error');
  }
  return;
}
```

**Step 3: Manually verify end-to-end**

1. Open the app with at least two workspaces that have sessions with different workingDirs
2. Expand a workspace — confirm directory groups are visible
3. Drag a folder group header onto a different workspace
4. Confirm: the folder group disappears from the source workspace and appears in the target workspace
5. Confirm: a single success toast shows with the correct session count
6. Reload the page — confirm the moves persisted (stored server-side)

**Step 4: Commit**

```bash
git add src/web/public/app.js
git commit -m "feat: handle cwm/project-group drop to move folder group between workspaces"
```

---

### Task 6: Final integration check

**Step 1: Edge cases to verify manually**

- Drop folder group onto its own workspace → nothing happens, no error
- Drop folder group onto a workspace where the same directory already exists → sessions merge into the existing group (handled naturally since they share the same `workingDir`)
- Drag a single-session group → 1 session moved, toast says "1 session"
- Drag a multi-session group → all move, toast count matches

**Step 2: Commit the design doc**

```bash
git add docs/plans/
git commit -m "docs: add folder-group drag-to-workspace design and plan"
```
