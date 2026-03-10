# Session Naming Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove project-folder auto-naming from sessions; sessions start nameless and get auto-named to their Claude UUID once generated; /clear resets the name.

**Architecture:** Two parallel name systems exist — workspace session `.name` (store sessions array) used in the sidebar, and `sessionNames[UUID]` (store map) used in the Discovered tab. Both must be handled. UUID detection happens server-side in pty-manager.js via polling; the client must be notified via a WebSocket control message. `/clear` creates a new JSONL file, which triggers a new UUID via the existing 30s polling — no separate /clear detection needed.

**Tech Stack:** Node.js, vanilla JS frontend, xterm.js, SSE + WebSocket for real-time updates

---

## Background: How names currently flow

- `applyDetectedUUID()` (pty-manager.js:434) fires 8s after spawn and every 30s. When UUID changes, it carries `storeSession.name` to `sessionNames[newUUID]`.
- `onTitleChange` (app.js:9162) fires on OSC 2 terminal title changes and calls `syncSessionTitle()` — this auto-assigns OSC 2 titles as session names.
- Many app.js code paths pass `path.split('\\').pop()` as the session name when creating or registering sessions.
- After `/clear`, the existing UUID polling detects the new JSONL file (oldUUID !== null case) within 30s.

## Desired flow after this change

1. Session created → name is `''`, UI shows greyed-out "untitled" placeholder
2. UUID detected by pty-manager → name becomes the UUID string (auto source)
3. User manually renames → name becomes custom name (manual source, never overwritten by auto)
4. User types `/clear` → within 30s polling, new UUID detected, name resets to new UUID

---

### Task 1: Modify `applyDetectedUUID` to use UUID as auto-name + send WebSocket push

**Files:**
- Modify: `src/web/pty-manager.js` lines 433–479

**Step 1: Read pty-manager.js around the applyDetectedUUID function**

Read lines 393–480 to confirm exact variable names and the `session.clients` structure (how clients are tracked for the WebSocket push — may be `session.clients`, `session.ws`, or a Set).

**Step 2: Write failing test**

No automated test file exists for pty-manager UUID logic. Instead, manually verify the behavior by running the server after the change and observing console logs for `[PTY] New Claude session UUID`.

**Step 3: Implement the changes**

In `applyDetectedUUID` (lines 447–459), replace the existing name-carry logic with:

```javascript
// Apply a newly detected UUID — auto-name to UUID, or carry manual name
function applyDetectedUUID(newUUID, newMtime) {
  if (newUUID === trackedUUID) return;
  const oldUUID = trackedUUID;
  trackedUUID = newUUID;
  trackedMtime = newMtime;

  console.log(`[PTY] New Claude session UUID for ${sessionId}: ${newUUID}${oldUUID ? ' (was ' + oldUUID + ')' : ''}`);

  try {
    const store = getStore();
    if (store.getSession(sessionId)) {
      const storeSession = store.getSession(sessionId);
      if (oldUUID) {
        // After /clear: always reset — fresh start regardless of old name
        store.updateSession(sessionId, { name: '' });
        store.setSessionName(newUUID, newUUID, 'auto');
      } else {
        // First UUID detection: carry manual name if set, otherwise use UUID
        store.updateSession(sessionId, { resumeSessionId: newUUID });
        if (storeSession && storeSession.name && storeSession.nameIsCustom) {
          store.setSessionName(newUUID, storeSession.name, 'manual');
        } else {
          store.setSessionName(newUUID, newUUID, 'auto');
        }
      }
    } else {
      // Session not in store (e.g., "New Session Here" pane) — still record UUID name
      store.setSessionName(newUUID, newUUID, 'auto');
    }

    // Push uuid-detected control message to all attached WebSocket clients
    const displayName = (store.getSessionName && store.getSessionName(newUUID)) || newUUID;
    // Find all clients attached to this session and notify them
    // NOTE: Check the exact property name — may be session.clients (Set/Array) or session.ws
    const clients = session.clients || (session.ws ? [session.ws] : []);
    for (const ws of clients) {
      try {
        if (ws.readyState === 1 /* OPEN */) {
          ws.send(JSON.stringify({ type: 'uuid-detected', uuid: newUUID, name: displayName }));
        }
      } catch (_) {}
    }
  } catch (_) {}

  session.detectedResumeId = newUUID;
}
```

Also fix: `store.updateSession(sessionId, { resumeSessionId: newUUID })` must remain in the non-clear path (first UUID). Make sure it's present after the else branch above, not inside the if-store-session block (in the original it was line 445 outside the name-carry block).

**Step 4: Check if `store.getSessionName` exists**

Grep `src/state/store.js` for `getSessionName`. If it doesn't exist, replace `store.getSessionName(newUUID)` with `(store.state && store.state.sessionNames && store.state.sessionNames[newUUID])` or similar.

**Step 5: Commit**

```bash
git add src/web/pty-manager.js
git commit -m "feat(naming): auto-assign UUID as session name on detection, reset on clear"
```

---

### Task 2: Handle uuid-detected control message in terminal.js + app.js

**Files:**
- Modify: `src/web/public/terminal.js` (WebSocket message handler)
- Modify: `src/web/public/app.js` (pane setup, around line 9161)

**Step 1: Add message parsing in terminal.js WebSocket handler**

Find the WebSocket `onmessage` handler in terminal.js (grep for `ws.onmessage` or `this.ws.onmessage`). The handler currently passes all data to xterm. Add a JSON parse guard at the TOP of the handler, before writing to the terminal:

```javascript
// At the top of ws.onmessage / ws.addEventListener('message', ...)
this.ws.addEventListener('message', (event) => {
  const data = event.data;
  // Check for server control messages (JSON) before treating as PTY data
  if (typeof data === 'string' && data.startsWith('{')) {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'uuid-detected') {
        this.onUuidDetected?.(msg.uuid, msg.name);
        return; // Don't write JSON to terminal
      }
    } catch (_) { /* Not JSON, fall through */ }
  }
  // Normal PTY data — write to terminal
  this.term.write(data);
});
```

**Note:** If the current handler uses binary data or ArrayBuffer, add a check: only attempt JSON parse for string data. PTY binary frames will not start with `{`.

**Step 2: Disable onTitleChange auto-naming in app.js**

Find the `tp.onTitleChange` assignment (app.js ~line 9162). Replace with:

```javascript
// OSC 2 terminal title changes no longer drive session naming
// Session names are now driven by uuid-detected WebSocket control messages
tp.onTitleChange = null;
```

**Step 3: Add onUuidDetected handler in app.js pane setup**

After the `tp.onTitleChange = null` line, add:

```javascript
tp.onUuidDetected = (uuid, name) => {
  const slotIdx = this.terminalPanes.indexOf(tp);
  if (slotIdx === -1) return;
  // Update in-memory pane name
  tp.sessionName = name || uuid;
  // Update pane title bar
  const paneEl = document.getElementById(`term-pane-${slotIdx}`);
  const titleEl = paneEl && paneEl.querySelector('.terminal-pane-title');
  if (titleEl) {
    titleEl.textContent = tp.sessionName;
    titleEl.classList.remove('session-name-empty');
  }
  // Refresh session lists to reflect the new name
  this.renderProjects();
  this.loadSessions().then(() => this.renderWorkspaces());
};
```

**Step 4: Commit**

```bash
git add src/web/public/terminal.js src/web/public/app.js
git commit -m "feat(naming): push uuid-detected to terminal pane on UUID assignment"
```

---

### Task 3: Remove folder-name derivation across app.js

**Files:**
- Modify: `src/web/public/app.js` (multiple locations)

Read each location before editing. All changes are simple replacements.

**Step 1: New Session Here (context menu) — lines ~3307–3333**

Read lines 3300–3340. Find both `openTerminalInPane(emptySlot, sid, displayName, ...)` calls (regular and bypass variant). Change `displayName` → `''`:

```javascript
// Was: this.openTerminalInPane(emptySlot, sid, displayName, {
this.openTerminalInPane(emptySlot, sid, '', {
```

Two occurrences (regular + bypass).

**Step 2: `ensureSessionRegistered` callsites — remove folder-name fallback**

Find all lines matching `const fallbackName = dirParts[dirParts.length - 1] || ` (grep for `fallbackName`). Each has the pattern:

```javascript
const dirParts = (projectPath || '').replace(/\\/g, '/').split('/').filter(Boolean);
const fallbackName = dirParts[dirParts.length - 1] || sessName;
const session = await this.ensureSessionRegistered(sessName, fallbackName, projectPath);
```

Change to:

```javascript
const session = await this.ensureSessionRegistered(sessName, sessName, projectPath);
```

(Remove the `dirParts` and `fallbackName` lines entirely. The `sessName` IS the Claude UUID, which is the correct fallback name now.)

Locations to fix (verify exact lines by reading):
- ~line 1771 (open discovered session on click)
- ~line 8822 (open conversation from discovered tab action)
- ~line 8948 (drag-drop project session)

**Step 3: `createSessionInDir()` — remove name from dir**

Find `createSessionInDir` (grep). Read the function (~line 2616). Change:

```javascript
// Was:
const dirParts = dir.replace(/\\/g, '/').split('/');
const name = dirParts[dirParts.length - 1] || 'new-session';
// ...
name: `${name} - new`,

// New:
name: '',
```

Remove the `dirParts` and `name` lines. Pass `name: ''` directly.

**Step 4: `_launchContextSession` — remove name from dir**

Grep for `_launchContextSession` and read the function. Find where `projectName` is derived from dir split (~line 6189). Change the `name:` field in the `createSession` call to `name: ''`. Remove unused `dirParts`/`projectName` lines.

**Step 5: Launcher form — remove auto-fill**

Read lines 15640–15660. Find:

```javascript
// Auto-generate a session name from the project directory name
if (!this.els.launcherSessionName.value) {
  this.els.launcherSessionName.value = name + ' - new';
}
```

Delete this entire if-block. Also on the form submit (~line 15760), change:

```javascript
// Was: const name = this.els.launcherSessionName.value.trim() || 'new-session';
const name = this.els.launcherSessionName.value.trim() || '';
```

**Step 6: Drag-drop handler — remove friendlyName path derivation**

Read lines 1636–1650. Find the drag-drop handler that creates `friendlyName = projectName + ' (' + shortId + ')'`. Change the `name:` in the `api('POST', '/api/sessions', ...)` call:

```javascript
// Was: name: friendlyName,
name: claudeSessionId,  // UUID is the auto-name
```

Remove unused `projectName`, `shortId`, `friendlyName` variable declarations.

**Step 7: Remaining friendlyName patterns in context menu**

Read lines 3155–3210 for `showProjectSessionContextMenu`. Find `friendlyName` derivations (used for `name:` when registering discovered sessions). Replace with UUID:

```javascript
// Was: name: friendlyName,
name: claudeSessionId,
```

Remove unused `projectName`, `shortId`, `friendlyName` variables.

**Step 8: Run server + manual smoke test**

Start the server. Open a project's discovered tab. Right-click → New Session Here. Confirm the pane title shows "untitled" (placeholder) instead of the folder name.

**Step 9: Commit**

```bash
git add src/web/public/app.js
git commit -m "feat(naming): remove folder-name derivation from all session creation paths"
```

---

### Task 4: Add CSS placeholder styling + update all name display locations

**Files:**
- Modify: `src/web/public/styles.css` (or wherever the main CSS lives — grep for `.ws-session-name`)
- Modify: `src/web/public/app.js` (rendering functions)
- Modify: `src/web/public/index.html` (launcher placeholder text)

**Step 1: Add CSS class**

Find the CSS file (grep codebase for `.ws-session-name` to locate it). Add:

```css
.session-name-empty {
  color: var(--overlay0);
  font-style: italic;
}
```

**Step 2: Terminal pane title bar**

Find `openTerminalInPane` in app.js (grep). Find where the pane title element is set (the line `titleEl.textContent = sessionName || sessionId`). Replace with:

```javascript
if (sessionName) {
  titleEl.textContent = sessionName;
  titleEl.classList.remove('session-name-empty');
} else {
  titleEl.textContent = 'untitled';
  titleEl.classList.add('session-name-empty');
}
```

Also find layout-restore pane creation code (grep for `sessionName || 'Terminal'`) and change both occurrences:
```javascript
// Was: sessionName || 'Terminal'
sessionName || ''
```
And ensure the same `titleEl` code above is used there too.

**Step 3: Workspace sidebar session list**

Find `renderWorkspaces` or `renderSessionList` (grep for `ws-session-name`). Find where session name is inserted into HTML. Change:

```javascript
// Was: <span class="ws-session-name">${this.escapeHtml(name)}</span>
// New:
const nameHtml = name
  ? `<span class="ws-session-name">${this.escapeHtml(name)}</span>`
  : `<span class="ws-session-name session-name-empty">untitled</span>`;
```

Use `nameHtml` in the template literal.

**Step 4: Discovered tab project session items**

Find `renderProjects` (grep). Find where `.project-session-name` is rendered (grep for `project-session-name`). Change:

```javascript
// Was: <span class="project-session-name">${this.escapeHtml(displayTitle)}</span>
// New:
const titleHtml = displayTitle
  ? `<span class="project-session-name">${this.escapeHtml(displayTitle)}</span>`
  : `<span class="project-session-name session-name-empty">untitled</span>`;
```

Where `displayTitle = this.getProjectSessionTitle(sessionUUID) || ''`.

**Step 5: Update launcher form placeholder text**

In `src/web/public/index.html`, find `id="launcher-session-name"`. Change placeholder:

```html
<!-- Was: placeholder="my-feature" -->
<input type="text" id="launcher-session-name" class="launcher-form-input" placeholder="optional" spellcheck="false" autocomplete="off" />
```

**Step 6: Verify visual appearance**

Start server. Open the UI. Check:
- Workspace sidebar: sessions with no name show italic grey "untitled"
- Discovered tab: same for sessions with no stored title
- Terminal pane title: shows italic grey "untitled" for new sessions
- Launcher form: name field shows light placeholder text "optional"
- After UUID is detected: all of the above update to show the UUID

**Step 7: Commit**

```bash
git add src/web/public/styles.css src/web/public/app.js src/web/public/index.html
git commit -m "feat(naming): show untitled placeholder for sessions without a name"
```

---

### Task 5: Final verification pass

**Step 1: Test new session from discovered tab right-click**

1. Right-click a project → "New Session Here"
2. Pane title should show "untitled" (italic/grey)
3. Type a message to Claude and send it
4. Within 30 seconds, pane title should update to the Claude UUID (e.g., `abc12345-...`)
5. Discovered tab should now show that UUID under the project

**Step 2: Test manual rename**

1. With a session showing its UUID, double-click the session name in the sidebar
2. Type a custom name and confirm
3. Verify it shows the custom name in both sidebar and discovered tab

**Step 3: Test /clear**

1. In an active named session (showing UUID), type `/clear` and press Enter
2. Within 30s, the session name should update to a new UUID (new conversation)
3. If you had a MANUAL name: it should reset to the new UUID (manual names do not persist across /clear)

**Step 4: Test launcher form**

1. Open the launcher (+ button)
2. Select a project directory
3. Verify the session name field does NOT auto-fill with the folder name
4. Placeholder text should say "optional"
5. Leave it empty and launch — session starts with "untitled" display

**Step 5: Commit if any fixes needed**

```bash
git add -A
git commit -m "fix(naming): post-verification fixes"
```

---

## Notes for implementer

- `session.clients` may be named differently in pty-manager.js — read `attachClient` (line ~492) to find the Set/Array where WebSocket clients are stored per session before writing Task 1.
- `store.getSessionName(uuid)` may not exist — check store.js for the method. If absent, read directly from `store.state.sessionNames[uuid]`.
- The `sessionNames[oldUUID]` entry is NOT deleted on /clear. It stays as a historical record of the old conversation — visible in the discovered tab as a separate session entry. This is correct behavior.
- `syncSessionTitle` still guards against empty strings (line 3618) — do not attempt to call it with `''` to clear names. The reset happens via `store.updateSession` directly in pty-manager.
