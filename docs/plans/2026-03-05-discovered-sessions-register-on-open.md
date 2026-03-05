# Discovered Sessions: Register on Open — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When a session is opened from the Discovered panel (click, drag-and-drop, or Find Conversation), automatically create a managed session record so it appears in Ctrl+K and the session list.

**Architecture:** Add two helpers to `App` in `app.js`: `findOrCreateWorkspaceForDir(dir)` (extracted from existing launcher logic) and `ensureSessionRegistered(claudeUUID, fallbackName, projectPath)` (idempotent — skips if record already exists). Update three entry points to call `ensureSessionRegistered` before `openTerminalInPane`, and pass the managed session's `id` as the PTY session ID so focus-by-ID keeps working.

**Tech Stack:** Vanilla JS, existing `this.api()` helper, existing server endpoints `POST /api/workspaces` and `POST /api/sessions`.

---

### Task 1: Extract `findOrCreateWorkspaceForDir` helper

**Files:**
- Modify: `src/web/public/app.js:15719-15741` (source to extract from)
- Insert new method near the launcher helpers, around line 15710 (just before `launchFromLauncher`)

**Step 1: Locate the exact insertion point**

Search `app.js` for `launchFromLauncher` to find the method boundary. The new helper goes immediately before it.

**Step 2: Add the helper method**

Insert this method before `launchFromLauncher`:

```javascript
/**
 * Find an existing workspace whose sessions share `dir` as workingDir,
 * or whose name matches the folder name. Creates one if nothing matches.
 * @param {string} dir - Absolute path of the project directory
 * @returns {Promise<string>} workspaceId
 */
async findOrCreateWorkspaceForDir(dir) {
  const normDir = dir.replace(/\\/g, '/').toLowerCase();
  const dirParts = dir.replace(/\\/g, '/').split('/').filter(Boolean);
  const projectName = dirParts[dirParts.length - 1] || 'project';

  // Match by existing session workingDir
  for (const ws of (this.state.workspaces || [])) {
    const wsSessions = (this.state.allSessions || []).filter(s => s.workspaceId === ws.id);
    if (wsSessions.some(s => s.workingDir && s.workingDir.replace(/\\/g, '/').toLowerCase() === normDir)) {
      return ws.id;
    }
  }
  // Match by workspace name
  const nameMatch = (this.state.workspaces || []).find(ws => ws.name.toLowerCase() === projectName.toLowerCase());
  if (nameMatch) return nameMatch.id;

  // Create new workspace
  const wsData = await this.api('POST', '/api/workspaces', { name: projectName });
  await this.loadWorkspaces();
  return (wsData.workspace || wsData).id;
}
```

**Step 3: Remove the duplicate inline logic from `launchFromLauncher`**

In `launchFromLauncher` (around line 15719), replace the block:
```javascript
// Find or create a workspace for this project
const dirParts = dir.replace(/\\/g, '/').split('/').filter(Boolean);
const projectName = dirParts[dirParts.length - 1] || 'project';

let workspaceId = null;
for (const ws of (this.state.workspaces || [])) {
  const wsSessions = (this.state.allSessions || []).filter(s => s.workspaceId === ws.id);
  if (wsSessions.some(s => s.workingDir && s.workingDir.replace(/\\/g, '/').toLowerCase() === dir.replace(/\\/g, '/').toLowerCase())) {
    workspaceId = ws.id;
    break;
  }
}
if (!workspaceId) {
  const nameMatch = (this.state.workspaces || []).find(ws => ws.name.toLowerCase() === projectName.toLowerCase());
  if (nameMatch) workspaceId = nameMatch.id;
}
if (!workspaceId) {
  const wsData = await this.api('POST', '/api/workspaces', { name: projectName });
  workspaceId = (wsData.workspace || wsData).id;
  await this.loadWorkspaces();
}
```

With:
```javascript
const workspaceId = await this.findOrCreateWorkspaceForDir(dir);
```

**Step 4: Verify the app still works**

Open the launcher (the `+` button or equivalent), create a session in a new directory. Confirm no console errors and the session appears in the session list.

**Step 5: Commit**

```bash
git add src/web/public/app.js
git commit -m "refactor: extract findOrCreateWorkspaceForDir helper from launcher"
```

---

### Task 2: Add `ensureSessionRegistered` helper

**Files:**
- Modify: `src/web/public/app.js` — insert method after `findOrCreateWorkspaceForDir`

**Step 1: Add the helper method**

Insert immediately after `findOrCreateWorkspaceForDir`:

```javascript
/**
 * Ensure a Claude session UUID has a managed session record in state.
 * Idempotent: if a record with resumeSessionId === claudeUUID already exists,
 * returns it immediately without creating a duplicate.
 * @param {string} claudeUUID - The Claude session UUID (from ~/.claude/projects/)
 * @param {string} fallbackName - Name to use if no stored title exists
 * @param {string} projectPath - Absolute path of the project directory
 * @returns {Promise<object>} The managed session record
 */
async ensureSessionRegistered(claudeUUID, fallbackName, projectPath) {
  // Return existing record if already registered
  const existing = (this.state.allSessions || []).find(s => s.resumeSessionId === claudeUUID);
  if (existing) return existing;

  const workspaceId = await this.findOrCreateWorkspaceForDir(projectPath);
  const storedTitle = this.getProjectSessionTitle(claudeUUID);
  const name = storedTitle || fallbackName;

  const data = await this.api('POST', '/api/sessions', {
    name,
    workspaceId,
    workingDir: projectPath,
    resumeSessionId: claudeUUID,
    command: 'claude',
  });
  const session = data.session || data;

  await this.loadSessions();
  await this.loadStats();
  return session;
}
```

**Step 2: Verify the helpers exist**

Open the browser console and confirm `app.ensureSessionRegistered` and `app.findOrCreateWorkspaceForDir` are callable (no syntax errors on load).

**Step 3: Commit**

```bash
git add src/web/public/app.js
git commit -m "feat: add ensureSessionRegistered helper for discovered sessions"
```

---

### Task 3: Update the Discovered panel click handler

**Files:**
- Modify: `src/web/public/app.js:~1776-1799`

**Context:** The click handler on `.project-session-item` currently calls `openTerminalInPane` directly with the raw Claude UUID as the PTY session ID.

**Step 1: Find the exact block**

Search for `// Already open → redirect focus` — the surrounding block is the target.

**Step 2: Replace the block**

Replace:
```javascript
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
  this.renderProjects();
} else {
  this.showToast('All panes are occupied — close one first', 'warning');
}
```

With:
```javascript
// Already open → redirect focus (check by managed session ID if registered)
const existingManaged = (this.state.allSessions || []).find(s => s.resumeSessionId === sessName);
if (this.focusPaneBySessionId(existingManaged ? existingManaged.id : sessName)) {
  this.showToast('Focused existing session', 'info');
  return;
}
// Not open → register session then open in next empty pane
const emptySlot = this.terminalPanes.findIndex(p => p === null);
if (emptySlot !== -1) {
  try {
    const dirParts = (projectPath || '').replace(/\\/g, '/').split('/').filter(Boolean);
    const fallbackName = dirParts[dirParts.length - 1] || sessName;
    const session = await this.ensureSessionRegistered(sessName, fallbackName, projectPath);
    this.openTerminalInPane(emptySlot, session.id, session.name, {
      cwd: projectPath,
      resumeSessionId: sessName,
      command: 'claude',
    });
    this.setViewMode('terminal');
    this.renderProjects();
  } catch (err) {
    this.showToast(err.message || 'Failed to open session', 'error');
  }
} else {
  this.showToast('All panes are occupied — close one first', 'warning');
}
```

**Step 3: Manual test**

1. Open the Discovered panel in the sidebar
2. Click a session that is NOT already in any workspace
3. Verify: terminal opens, AND the session appears in the session list and Ctrl+K
4. Click the same session again — verify it focuses the existing pane (no duplicate)

**Step 4: Commit**

```bash
git add src/web/public/app.js
git commit -m "feat(discovered): register session on click in Discovered panel"
```

---

### Task 4: Update `openConversationResult`

**Files:**
- Modify: `src/web/public/app.js:8821-8835`

**Step 1: Replace the method body**

Replace:
```javascript
openConversationResult(sessionId, projectPath) {
  // Open the session in a terminal pane - not added to any workspace
  const emptySlot = this.terminalPanes.findIndex(p => p === null);
  if (emptySlot === -1) {
    this.showToast('All terminal panes full. Close one first.', 'warning');
    return;
  }
  this.setViewMode('terminal');
  this.openTerminalInPane(emptySlot, sessionId, sessionId, {
    cwd: projectPath,
    resumeSessionId: sessionId,
    command: 'claude',
  });
  this.showToast('Opening conversation in terminal', 'info');
}
```

With:
```javascript
async openConversationResult(sessionId, projectPath) {
  const existingManaged = (this.state.allSessions || []).find(s => s.resumeSessionId === sessionId);
  if (this.focusPaneBySessionId(existingManaged ? existingManaged.id : sessionId)) {
    this.showToast('Focused existing session', 'info');
    return;
  }
  const emptySlot = this.terminalPanes.findIndex(p => p === null);
  if (emptySlot === -1) {
    this.showToast('All terminal panes full. Close one first.', 'warning');
    return;
  }
  try {
    const dirParts = (projectPath || '').replace(/\\/g, '/').split('/').filter(Boolean);
    const fallbackName = dirParts[dirParts.length - 1] || sessionId;
    const session = await this.ensureSessionRegistered(sessionId, fallbackName, projectPath);
    this.setViewMode('terminal');
    this.openTerminalInPane(emptySlot, session.id, session.name, {
      cwd: projectPath,
      resumeSessionId: sessionId,
      command: 'claude',
    });
    this.showToast('Opening conversation in terminal', 'info');
  } catch (err) {
    this.showToast(err.message || 'Failed to open conversation', 'error');
  }
}
```

**Step 2: Manual test**

Use Find Conversation (Ctrl+F or the find conversation button) to open a session. Verify it appears in the session list and Ctrl+K after opening.

**Step 3: Commit**

```bash
git add src/web/public/app.js
git commit -m "feat(discovered): register session via Find Conversation"
```

---

### Task 5: Update the `cwm/project-session` drag-and-drop handler

**Files:**
- Modify: `src/web/public/app.js:~8937-8961`

**Step 1: Find the exact block**

Search for `// Drop a project-session (individual .jsonl from project accordion) into terminal pane`.

**Step 2: Replace the inner handler**

Replace:
```javascript
console.log('[DnD] Project-session drop - resumeSessionId:', claudeSessionId, 'cwd:', ps.projectPath);
// Open terminal directly - use the Claude session UUID as the PTY session ID
// so the PTY manager can reuse it on subsequent drops
this.openTerminalInPane(slotIdx, claudeSessionId, claudeSessionId, {
  cwd: ps.projectPath,
  resumeSessionId: claudeSessionId,
  command: 'claude',
  ...(this.state.settings.defaultBypassPermissions ? { bypassPermissions: true } : {}),
});
this.showToast('Opening session - drag to a project to save it', 'info');
this.renderProjects();
```

With:
```javascript
console.log('[DnD] Project-session drop - resumeSessionId:', claudeSessionId, 'cwd:', ps.projectPath);
const dirParts = (ps.projectPath || '').replace(/\\/g, '/').split('/').filter(Boolean);
const fallbackName = dirParts[dirParts.length - 1] || claudeSessionId;
const session = await this.ensureSessionRegistered(claudeSessionId, fallbackName, ps.projectPath);
this.openTerminalInPane(slotIdx, session.id, session.name, {
  cwd: ps.projectPath,
  resumeSessionId: claudeSessionId,
  command: 'claude',
  ...(this.state.settings.defaultBypassPermissions ? { bypassPermissions: true } : {}),
});
this.showToast('Opening session', 'info');
this.renderProjects();
```

Note: the surrounding `try/catch` already exists in this block, so errors are handled.

Also update the already-open focus check just above (line ~8943) to use the managed ID:

Replace:
```javascript
if (this.focusPaneBySessionId(claudeSessionId)) {
```

With:
```javascript
const existingForFocus = (this.state.allSessions || []).find(s => s.resumeSessionId === claudeSessionId);
if (this.focusPaneBySessionId(existingForFocus ? existingForFocus.id : claudeSessionId)) {
```

**Step 3: Manual test**

1. Drag a session from the Discovered panel onto a terminal pane
2. Verify the terminal opens AND the session appears in the session list and Ctrl+K
3. Drag the same session again — verify it focuses the existing pane

**Step 4: Commit**

```bash
git add src/web/public/app.js
git commit -m "feat(discovered): register session on drag-and-drop from Discovered panel"
```

---

### Task 6: Smoke test all three paths end-to-end

**Step 1: Verify click path**
1. Find a session in the Discovered panel not already in any workspace
2. Click it — terminal opens
3. Press Ctrl+K — session appears in results
4. Check the sidebar session list — session appears under correct workspace
5. Click it again in Discovered — pane focuses (no second terminal)

**Step 2: Verify drag-and-drop path**
1. Drag a different session onto a terminal pane
2. Repeat checks from Step 1

**Step 3: Verify Find Conversation path**
1. Use Find Conversation to open a session
2. Repeat checks from Step 1

**Step 4: Verify idempotency on reload**
1. Open the app fresh (page reload)
2. The sessions registered in previous steps should still be in the session list (they were persisted to the server)
3. Opening them from Discovered again should focus the pane, not duplicate

**Step 5: Commit any remaining fixes, then wrap up**

```bash
git add src/web/public/app.js
git commit -m "fix(discovered): address any issues found in smoke test"
```
