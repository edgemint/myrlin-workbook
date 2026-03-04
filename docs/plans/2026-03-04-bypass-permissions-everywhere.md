# Bypass Permissions Everywhere — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add bypass permissions access to every session-launch entry point that currently lacks it — parallel context menu items for direct actions, checkboxes for modal dialogs, and a checkbox on the detail panel.

**Architecture:** All changes are in `src/web/public/app.js` (JS logic) and `src/web/public/index.html` (detail panel HTML). No backend changes needed — `bypassPermissions` is already a first-class field on sessions and `openTerminalInPane` already accepts it in `spawnOpts`. We add: (1) parallel context menu items that mirror existing ones with bypass forced on, (2) checkbox fields to existing `showPromptModal` calls, and (3) a persistent checkbox in the detail control bar.

**Tech Stack:** Vanilla JS, HTML — no build step, edit files directly and reload the browser.

---

### Task 1: Add `restartSessionWithFlags` helper

**Files:**
- Modify: `src/web/public/app.js` — after `startSessionWithFlags` (~line 5608)

**Step 1: Add the helper**

Find the end of `startSessionWithFlags` (closes around line 5608). Insert immediately after:

```js
  async restartSessionWithFlags(sessionId, flags) {
    try {
      if (flags.bypassPermissions !== undefined) {
        await this.api('PUT', `/api/sessions/${sessionId}`, { bypassPermissions: flags.bypassPermissions });
      }
      await this.api('POST', `/api/sessions/${sessionId}/restart`);
      this.showToast('Session restarted', 'success');
      await this.refreshSessionData(sessionId);
    } catch (err) {
      this.showToast(err.message || 'Failed to restart session', 'error');
    }
  }
```

**Step 2: Verify**

Search the file for `restartSessionWithFlags` — should appear once (the new definition).

**Step 3: Commit**

```bash
git add src/web/public/app.js
git commit -m "Add restartSessionWithFlags helper"
```

---

### Task 2: Propagate opts through context-session flow

**Files:**
- Modify: `src/web/public/app.js` — `_launchContextSession`, `startSessionWithContext`, `startProjectWithContext`

**Step 1: Update `_launchContextSession`**

Find: `async _launchContextSession(dir, wsId) {`
Replace with: `async _launchContextSession(dir, wsId, opts = {}) {`

Find the `payload` object inside that function:
```js
      const payload = {
        name: `${projectName} - context`,
        workspaceId: wsId,
        workingDir: dir,
        command: 'claude',
      };
```
Replace with:
```js
      const payload = {
        name: `${projectName} - context`,
        workspaceId: wsId,
        workingDir: dir,
        command: 'claude',
      };
      if (opts.bypassPermissions) payload.bypassPermissions = true;
```

Find the `openTerminalInPane` call inside `_launchContextSession`:
```js
      this.openTerminalInPane(emptySlot, newSession.id, newSession.name, { cwd: dir });
```
Replace with:
```js
      this.openTerminalInPane(emptySlot, newSession.id, newSession.name, { cwd: dir, ...(opts.bypassPermissions ? { bypassPermissions: true } : {}) });
```

**Step 2: Update `startSessionWithContext`**

Find: `async startSessionWithContext(sessionId) {`
Replace with: `async startSessionWithContext(sessionId, opts = {}) {`

Find the call to `_launchContextSession` inside it:
```js
    await this._launchContextSession(dir, wsId);
```
Replace with:
```js
    await this._launchContextSession(dir, wsId, opts);
```

**Step 3: Update `startProjectWithContext`**

Find: `async startProjectWithContext(projectPath) {`
Replace with: `async startProjectWithContext(projectPath, opts = {}) {`

Find the call to `_launchContextSession` inside it:
```js
    await this._launchContextSession(projectPath, wsId);
```
Replace with:
```js
    await this._launchContextSession(projectPath, wsId, opts);
```

**Step 4: Commit**

```bash
git add src/web/public/app.js
git commit -m "Thread opts through context-session launch flow"
```

---

### Task 3: Sidebar session context menu — "Open in Terminal (Bypass)" + "Restart (Bypass)"

**Files:**
- Modify: `src/web/public/app.js` — `showContextMenu` and `_buildSessionContextItems`

**Step 1: Add "Open in Terminal (Bypass)" to `showContextMenu`**

Find the existing "Open in Terminal" item (inside `showContextMenu`):
```js
    items.push({
      label: 'Open in Terminal', icon: '&#9654;', action: () => {
        const emptySlot = this.terminalPanes.findIndex(p => p === null);
        if (emptySlot !== -1) {
          this.setViewMode('terminal');
          const spawnOpts = {};
          if (session.resumeSessionId) spawnOpts.resumeSessionId = session.resumeSessionId;
          if (session.workingDir) spawnOpts.cwd = session.workingDir;
          if (session.command) spawnOpts.command = session.command;
          if (session.bypassPermissions) spawnOpts.bypassPermissions = true;
          if (session.verbose) spawnOpts.verbose = true;
          if (session.model) spawnOpts.model = session.model;
          if (session.agentTeams) spawnOpts.agentTeams = true;
          this.openTerminalInPane(emptySlot, sessionId, session.name, spawnOpts);
        } else {
          this.showToast('All terminal panes full. Close one first.', 'warning');
        }
      },
    });

    items.push({ type: 'sep' });
```

Replace with:
```js
    items.push({
      label: 'Open in Terminal', icon: '&#9654;', action: () => {
        const emptySlot = this.terminalPanes.findIndex(p => p === null);
        if (emptySlot !== -1) {
          this.setViewMode('terminal');
          const spawnOpts = {};
          if (session.resumeSessionId) spawnOpts.resumeSessionId = session.resumeSessionId;
          if (session.workingDir) spawnOpts.cwd = session.workingDir;
          if (session.command) spawnOpts.command = session.command;
          if (session.bypassPermissions) spawnOpts.bypassPermissions = true;
          if (session.verbose) spawnOpts.verbose = true;
          if (session.model) spawnOpts.model = session.model;
          if (session.agentTeams) spawnOpts.agentTeams = true;
          this.openTerminalInPane(emptySlot, sessionId, session.name, spawnOpts);
        } else {
          this.showToast('All terminal panes full. Close one first.', 'warning');
        }
      },
    });

    items.push({
      label: 'Open in Terminal (Bypass)', icon: '&#9888;', action: () => {
        const emptySlot = this.terminalPanes.findIndex(p => p === null);
        if (emptySlot !== -1) {
          this.setViewMode('terminal');
          const spawnOpts = {};
          if (session.resumeSessionId) spawnOpts.resumeSessionId = session.resumeSessionId;
          if (session.workingDir) spawnOpts.cwd = session.workingDir;
          if (session.command) spawnOpts.command = session.command;
          spawnOpts.bypassPermissions = true;
          if (session.verbose) spawnOpts.verbose = true;
          if (session.model) spawnOpts.model = session.model;
          if (session.agentTeams) spawnOpts.agentTeams = true;
          this.openTerminalInPane(emptySlot, sessionId, session.name, spawnOpts);
        } else {
          this.showToast('All terminal panes full. Close one first.', 'warning');
        }
      },
    });

    items.push({ type: 'sep' });
```

**Step 2: Add "Restart (Bypass)" to `_buildSessionContextItems`**

Find the running-state items block:
```js
    } else {
      items.push(
        { label: 'Stop', icon: '&#9632;', action: () => this.stopSession(sessionId) },
        { label: 'Restart', icon: '&#8635;', action: () => this.restartSession(sessionId) },
      );
    }
```

Replace with:
```js
    } else {
      items.push(
        { label: 'Stop', icon: '&#9632;', action: () => this.stopSession(sessionId) },
        { label: 'Restart', icon: '&#8635;', action: () => this.restartSession(sessionId) },
        { label: 'Restart (Bypass)', icon: '&#9888;', action: () => this.restartSessionWithFlags(sessionId, { bypassPermissions: true }) },
      );
    }
```

**Step 3: Add "Start with Context (Bypass)" to Advanced submenu in `_buildSessionContextItems`**

Find:
```js
    const advancedItems = [
      { label: 'Start with Context', action: () => this.startSessionWithContext(sessionId) },
```

Replace with:
```js
    const advancedItems = [
      { label: 'Start with Context', action: () => this.startSessionWithContext(sessionId) },
      { label: 'Start with Context (Bypass)', action: () => this.startSessionWithContext(sessionId, { bypassPermissions: true }) },
```

**Step 4: Commit**

```bash
git add src/web/public/app.js
git commit -m "Add Bypass parallel items to sidebar session context menu"
```

---

### Task 4: Workspace context menu — "Open Terminal (Bypass)"

**Files:**
- Modify: `src/web/public/app.js` — `showWorkspaceContextMenu`

**Step 1: Add the parallel item**

Find the "Open Terminal" item in `showWorkspaceContextMenu`:
```js
      { label: 'Open Terminal', icon: '&#9654;', action: () => {
        const emptySlot = this.terminalPanes.findIndex(p => p === null);
        if (emptySlot === -1) { this.showToast('All terminal panes full', 'warning'); return; }
        // Create a new session in this workspace and open terminal
        this.api('POST', '/api/sessions', { name: `${ws.name} terminal`, workspaceId }).then(data => {
          if (data && data.session) {
            this.loadSessions();
            this.setViewMode('terminal');
            this.openTerminalInPane(emptySlot, data.session.id, ws.name);
          }
        }).catch(err => this.showToast(err.message, 'error'));
      }},
```

Replace with:
```js
      { label: 'Open Terminal', icon: '&#9654;', action: () => {
        const emptySlot = this.terminalPanes.findIndex(p => p === null);
        if (emptySlot === -1) { this.showToast('All terminal panes full', 'warning'); return; }
        this.api('POST', '/api/sessions', { name: `${ws.name} terminal`, workspaceId }).then(data => {
          if (data && data.session) {
            this.loadSessions();
            this.setViewMode('terminal');
            this.openTerminalInPane(emptySlot, data.session.id, ws.name);
          }
        }).catch(err => this.showToast(err.message, 'error'));
      }},
      { label: 'Open Terminal (Bypass)', icon: '&#9888;', action: () => {
        const emptySlot = this.terminalPanes.findIndex(p => p === null);
        if (emptySlot === -1) { this.showToast('All terminal panes full', 'warning'); return; }
        this.api('POST', '/api/sessions', { name: `${ws.name} terminal`, workspaceId, bypassPermissions: true }).then(data => {
          if (data && data.session) {
            this.loadSessions();
            this.setViewMode('terminal');
            this.openTerminalInPane(emptySlot, data.session.id, ws.name, { bypassPermissions: true });
          }
        }).catch(err => this.showToast(err.message, 'error'));
      }},
```

**Step 2: Commit**

```bash
git add src/web/public/app.js
git commit -m "Add Open Terminal (Bypass) to workspace context menu"
```

---

### Task 5: Project context menu — "Start with Context (Bypass)"

**Files:**
- Modify: `src/web/public/app.js` — `showProjectContextMenu`

**Step 1: Add the parallel item**

Find in `showProjectContextMenu`:
```js
    items.push({
      label: 'Start with Context', icon: '&#128218;', action: () => this.startProjectWithContext(projectPath),
    });
```

Replace with:
```js
    items.push({
      label: 'Start with Context', icon: '&#128218;', action: () => this.startProjectWithContext(projectPath),
    });
    items.push({
      label: 'Start with Context (Bypass)', icon: '&#9888;', action: () => this.startProjectWithContext(projectPath, { bypassPermissions: true }),
    });
```

**Step 2: Commit**

```bash
git add src/web/public/app.js
git commit -m "Add Start with Context (Bypass) to project context menu"
```

---

### Task 6: Project session context menu — "Add to Project (Bypass)"

**Files:**
- Modify: `src/web/public/app.js` — `showProjectSessionContextMenu`

**Step 1: Add the parallel item**

Find the "Add to Project" push block (the one using `this.api('POST', '/api/sessions', {...})`). It ends with `});` followed by `items.push({ type: 'sep' });`.

Find:
```js
    // Add to active workspace (without opening terminal)
    items.push({
      label: 'Add to Project', icon: '&#43;', action: () => {
```

The full "Add to Project" block runs from that line to its closing `});`. After it, add:

```js
    items.push({
      label: 'Add to Project (Bypass)', icon: '&#9888;', action: () => {
        if (!this.state.activeWorkspace) {
          this.showToast('Select or create a project first', 'warning');
          return;
        }
        const projectName = projectPath ? projectPath.split('\\').pop() || projectPath.split('/').pop() || sessionName : sessionName;
        const shortId = sessionName.length > 8 ? sessionName.substring(0, 8) : sessionName;
        const friendlyName = projectName + ' (' + shortId + ')';
        this.api('POST', '/api/sessions', {
          name: friendlyName,
          workspaceId: this.state.activeWorkspace.id,
          workingDir: projectPath,
          topic: 'Resumed session',
          command: 'claude',
          resumeSessionId: sessionName,
          bypassPermissions: true,
        }).then(async () => {
          await this.loadSessions();
          await this.loadStats();
          this.renderWorkspaces();
          this.showToast(`Session added to ${this.state.activeWorkspace.name} (bypass on)`, 'success');
        }).catch(err => {
          this.showToast(err.message || 'Failed to add session', 'error');
        });
      },
    });
```

Place this immediately after the closing `});` of the existing "Add to Project" block, before `items.push({ type: 'sep' });`.

**Step 2: Commit**

```bash
git add src/web/public/app.js
git commit -m "Add Add to Project (Bypass) to project session context menu"
```

---

### Task 7: New Session modal — bypass checkbox

**Files:**
- Modify: `src/web/public/app.js` — `createSession`

**Step 1: Add checkbox to fields**

In `createSession`, find the `fields` array definition:
```js
    const fields = [
      { key: 'name', label: 'Name', placeholder: 'feature-auth', required: true },
      { key: 'topic', label: 'Topic', placeholder: 'Working on authentication flow' },
      { key: 'workingDir', label: 'Working Directory', placeholder: '~/projects/my-app' },
      { key: 'command', label: 'Command', placeholder: 'claude (default)' },
    ];
```

Replace with:
```js
    const fields = [
      { key: 'name', label: 'Name', placeholder: 'feature-auth', required: true },
      { key: 'topic', label: 'Topic', placeholder: 'Working on authentication flow' },
      { key: 'workingDir', label: 'Working Directory', placeholder: '~/projects/my-app' },
      { key: 'command', label: 'Command', placeholder: 'claude (default)' },
      { key: 'bypassPermissions', label: 'Bypass Permissions', type: 'checkbox', value: false },
    ];
```

**Step 2: Verify `result` is passed as-is to the API**

In `createSession`, find:
```js
      const data = await this.api('POST', '/api/sessions', result);
```

This already passes `bypassPermissions` from the form result since `result` is the full field map — no further change needed.

**Step 3: Commit**

```bash
git add src/web/public/app.js
git commit -m "Add bypass checkbox to New Session modal"
```

---

### Task 8: New Feature Session modal — bypass checkbox

**Files:**
- Modify: `src/web/public/app.js` — `startFeatureSession`

**Step 1: Add checkbox field**

In `startFeatureSession`, find:
```js
        { key: 'useWorktree', label: 'Create Worktree (recommended)', type: 'checkbox', value: true },
```

Replace with:
```js
        { key: 'useWorktree', label: 'Create Worktree (recommended)', type: 'checkbox', value: true },
        { key: 'bypassPermissions', label: 'Bypass Permissions', type: 'checkbox', value: false },
```

**Step 2: Thread bypass into session creation and terminal launch**

Find the session creation call inside `startFeatureSession`:
```js
      const sessionData = await this.api('POST', '/api/sessions', {
        name: result.featureName,
        workspaceId,
        workingDir: sessionDir,
        command: 'claude',
        topic: 'Feature: ' + result.featureName,
      });
```

Replace with:
```js
      const sessionData = await this.api('POST', '/api/sessions', {
        name: result.featureName,
        workspaceId,
        workingDir: sessionDir,
        command: 'claude',
        topic: 'Feature: ' + result.featureName,
        ...(result.bypassPermissions ? { bypassPermissions: true } : {}),
      });
```

Find the `openTerminalInPane` call inside `startFeatureSession`:
```js
        this.openTerminalInPane(emptySlot, sessionData.session.id, result.featureName, { cwd: sessionDir });
```

Replace with:
```js
        this.openTerminalInPane(emptySlot, sessionData.session.id, result.featureName, { cwd: sessionDir, ...(result.bypassPermissions ? { bypassPermissions: true } : {}) });
```

**Step 3: Commit**

```bash
git add src/web/public/app.js
git commit -m "Add bypass checkbox to New Feature Session modal"
```

---

### Task 9: New Worktree Task modal — bypass checkbox

**Files:**
- Modify: `src/web/public/app.js` — `startWorktreeTask`

**Step 1: Add checkbox field**

In `startWorktreeTask`, find the model selector push:
```js
    // Add model selector
    fields.push({ key: 'model', label: 'Model', type: 'select', options: [
```

Insert before it:
```js
    fields.push({ key: 'bypassPermissions', label: 'Bypass Permissions', type: 'checkbox', value: false });
```

**Step 2: Thread bypass into API call and terminal launch**

Find the `api('POST', '/api/worktree-tasks', {...})` call:
```js
      const data = await this.api('POST', '/api/worktree-tasks', {
        workspaceId,
        repoDir: result.repoDir,
        branch,
        description: result.description,
        baseBranch: result.baseBranch || 'main',
        featureId: result.featureId || undefined,
        model: result.model || undefined,
      });
```

Replace with:
```js
      const data = await this.api('POST', '/api/worktree-tasks', {
        workspaceId,
        repoDir: result.repoDir,
        branch,
        description: result.description,
        baseBranch: result.baseBranch || 'main',
        featureId: result.featureId || undefined,
        model: result.model || undefined,
        ...(result.bypassPermissions ? { bypassPermissions: true } : {}),
      });
```

Find the `openTerminalInPane` call inside `startWorktreeTask`:
```js
          this.openTerminalInPane(emptySlot, data.session.id, branch, { cwd: data.task.worktreePath });
```

Replace with:
```js
          this.openTerminalInPane(emptySlot, data.session.id, branch, { cwd: data.task.worktreePath, ...(result.bypassPermissions ? { bypassPermissions: true } : {}) });
```

**Step 3: Commit**

```bash
git add src/web/public/app.js
git commit -m "Add bypass checkbox to New Worktree Task modal"
```

---

### Task 10: Detail panel — bypass checkbox in HTML

**Files:**
- Modify: `src/web/public/index.html` — `detail-control-bar`

**Step 1: Add checkbox to HTML**

Find the detail control bar:
```html
            <div class="detail-control-bar">
              <button class="btn btn-primary btn-sm" id="detail-start-btn">
```

Replace with:
```html
            <div class="detail-control-bar">
              <label class="detail-bypass-label" style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--yellow);cursor:pointer;user-select:none;" title="Start/Restart with --dangerously-skip-permissions">
                <input type="checkbox" id="detail-bypass-cb" style="width:13px;height:13px;accent-color:var(--yellow);cursor:pointer;">
                Bypass
              </label>
              <button class="btn btn-primary btn-sm" id="detail-start-btn">
```

**Step 2: Commit**

```bash
git add src/web/public/index.html
git commit -m "Add bypass checkbox to detail panel control bar"
```

---

### Task 11: Wire detail panel bypass checkbox in JS

**Files:**
- Modify: `src/web/public/app.js` — `els` init, Start/Restart click handlers, `renderSessionDetail`

**Step 1: Register element**

Find the `els` initialization block (around line 271 where `detailStartBtn` is set):
```js
      detailStartBtn: document.getElementById('detail-start-btn'),
```

Add after it (or nearby):
```js
      detailBypassCb: document.getElementById('detail-bypass-cb'),
```

**Step 2: Update Start button handler**

Find:
```js
    this.els.detailStartBtn.addEventListener('click', () => {
      if (this.state.selectedSession) this.startSession(this.state.selectedSession.id);
```

Replace with:
```js
    this.els.detailStartBtn.addEventListener('click', () => {
      if (this.state.selectedSession) {
        const bypass = this.els.detailBypassCb && this.els.detailBypassCb.checked;
        if (bypass) {
          this.startSessionWithFlags(this.state.selectedSession.id, { bypassPermissions: true });
        } else {
          this.startSession(this.state.selectedSession.id);
        }
      }
```

Note: preserve the closing `});` that was already there (it closes the event listener).

**Step 3: Update Restart button handler**

Find:
```js
    this.els.detailRestartBtn.addEventListener('click', () => {
      if (this.state.selectedSession) this.restartSession(this.state.selectedSession.id);
```

Replace with:
```js
    this.els.detailRestartBtn.addEventListener('click', () => {
      if (this.state.selectedSession) {
        const bypass = this.els.detailBypassCb && this.els.detailBypassCb.checked;
        if (bypass) {
          this.restartSessionWithFlags(this.state.selectedSession.id, { bypassPermissions: true });
        } else {
          this.restartSession(this.state.selectedSession.id);
        }
      }
```

**Step 4: Sync checkbox with selected session in `renderSessionDetail`**

Find `renderSessionDetail` — search for where the detail panel buttons are enabled/disabled (around `detailStartBtn.disabled`):

```js
    this.els.detailStartBtn.disabled = isRunning;
```

Add after it:
```js
    if (this.els.detailBypassCb) this.els.detailBypassCb.checked = !!session.bypassPermissions;
```

**Step 5: Commit**

```bash
git add src/web/public/app.js
git commit -m "Wire detail panel bypass checkbox to Start/Restart handlers"
```

---

### Task 12: Smoke test all entry points

Reload the app in the browser and verify each entry point:

1. **Sidebar session right-click** → "Open in Terminal (Bypass)" appears
2. **Sidebar session right-click (running session)** → "Restart (Bypass)" appears
3. **Sidebar session right-click → Advanced** → "Start with Context (Bypass)" appears
4. **Workspace right-click** → "Open Terminal (Bypass)" appears
5. **Project header right-click** → "Start with Context (Bypass)" appears
6. **Project session right-click** → "Add to Project (Bypass)" appears
7. **New Session modal** → "Bypass Permissions" checkbox appears
8. **New Feature Session modal** → "Bypass Permissions" checkbox appears
9. **New Worktree Task modal** → "Bypass Permissions" checkbox appears
10. **Detail panel** → "Bypass" checkbox appears next to Start/Stop/Restart buttons; reflects session's stored bypass state when switching sessions
