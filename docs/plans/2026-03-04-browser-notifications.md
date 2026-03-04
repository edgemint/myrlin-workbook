# Browser Notifications Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a separate "Browser Notifications" setting that fires OS-level desktop notifications via the Web Notifications API when a terminal session goes idle.

**Architecture:** Single file change in `src/web/public/app.js`. Four surgical edits: add default, add registry entry, intercept the toggle's change handler, fire the OS notification in `onTerminalIdle`. No new files, no server changes.

**Tech Stack:** Vanilla JS, Web Notifications API (`new Notification()`), existing localStorage settings pattern.

---

### Task 1: Add default value for `browserNotifications`

**Files:**
- Modify: `src/web/public/app.js:124`

**Step 1: Open the file and find the settings defaults block**

It's around line 121. It looks like:
```js
settings: Object.assign({
  paneColorHighlights: true,
  activityIndicators: true,
  completionNotifications: true,   // ← line 124
  sessionCountInHeader: true,
```

**Step 2: Add the new default after `completionNotifications`**

Change:
```js
  completionNotifications: true,
  sessionCountInHeader: true,
```
To:
```js
  completionNotifications: true,
  browserNotifications: false,
  sessionCountInHeader: true,
```

**Step 3: Verify**

Search for `browserNotifications: false` in the file — it should appear exactly once (here).

**Step 4: Commit**
```bash
git add src/web/public/app.js
git commit -m "feat: add browserNotifications default setting"
```

---

### Task 2: Register the setting in `getSettingsRegistry()`

**Files:**
- Modify: `src/web/public/app.js:3476`

**Step 1: Find the registry entry for `completionNotifications`**

Around line 3476:
```js
{ key: 'completionNotifications', label: 'Completion Notifications', description: 'Sound and toast when a background terminal finishes', category: 'Notifications' },
```

**Step 2: Add the new entry immediately after it**

Change:
```js
{ key: 'completionNotifications', label: 'Completion Notifications', description: 'Sound and toast when a background terminal finishes', category: 'Notifications' },
{ key: 'sessionCountInHeader',
```
To:
```js
{ key: 'completionNotifications', label: 'Completion Notifications', description: 'Sound and toast when a background terminal finishes', category: 'Notifications' },
{ key: 'browserNotifications', label: 'Browser Notifications', description: 'OS desktop notification when any terminal finishes (requires browser permission)', category: 'Notifications' },
{ key: 'sessionCountInHeader',
```

**Step 3: Verify**

Open the app in a browser, open Settings, search for "Browser" — the new toggle should appear under the Notifications category.

**Step 4: Commit**
```bash
git add src/web/public/app.js
git commit -m "feat: add browserNotifications to settings registry"
```

---

### Task 3: Intercept the toggle to request browser permission

**Files:**
- Modify: `src/web/public/app.js:4171`

**Step 1: Find the settings change handler**

Around line 4171:
```js
// Bind toggle change events
this.els.settingsBody.querySelectorAll('input[data-setting]').forEach(input => {
  input.addEventListener('change', (e) => {
    const key = e.target.dataset.setting;
    this.state.settings[key] = e.target.checked;
    this.saveSettings();
    this.applySettings();
  });
});
```

**Step 2: Add a special case for `browserNotifications` before the generic save**

Change the handler body from:
```js
  input.addEventListener('change', (e) => {
    const key = e.target.dataset.setting;
    this.state.settings[key] = e.target.checked;
    this.saveSettings();
    this.applySettings();
  });
```
To:
```js
  input.addEventListener('change', async (e) => {
    const key = e.target.dataset.setting;

    if (key === 'browserNotifications' && e.target.checked) {
      if (!('Notification' in window)) {
        e.target.checked = false;
        this.showToast('Browser notifications are not supported in this browser.', 'error');
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        e.target.checked = false;
        this.showToast('Browser notification permission was denied. Enable it in your browser settings.', 'error');
        return;
      }
    }

    this.state.settings[key] = e.target.checked;
    this.saveSettings();
    this.applySettings();
  });
```

**Step 3: Verify manually**

1. Open Settings > Notifications
2. Toggle "Browser Notifications" ON
3. Browser should show a permission prompt
4. If you click "Allow": toggle stays on, no toast
5. If you click "Block": toggle flips back off, error toast appears saying "Browser notification permission was denied..."
6. If browser doesn't support Notifications API: toggle flips back, error toast appears

**Step 4: Commit**
```bash
git add src/web/public/app.js
git commit -m "feat: request browser permission when enabling browserNotifications setting"
```

---

### Task 4: Fire OS notification in `onTerminalIdle`

**Files:**
- Modify: `src/web/public/app.js:9229`

**Step 1: Find the end of `onTerminalIdle`**

Around line 9202–9230:
```js
  onTerminalIdle({ sessionId, sessionName }) {
    // Respect completion notifications setting
    if (!this.getSetting('completionNotifications')) return;

    // Don't notify for the currently focused/active pane
    const activeIdx = this.terminalPanes.findIndex(tp => tp && tp.sessionId === sessionId);
    if (activeIdx === this._activeTerminalSlot) return;

    // Flash the pane border green
    ...

    // Flash the browser tab title when the window isn't focused
    this._flashBrowserTitle(name);
  }  // ← line 9230
```

**Step 2: Add the browser notification block after `_flashBrowserTitle` and before the closing brace**

Change:
```js
    // Flash the browser tab title when the window isn't focused
    // so users know which window needs attention
    this._flashBrowserTitle(name);
  }
```
To:
```js
    // Flash the browser tab title when the window isn't focused
    // so users know which window needs attention
    this._flashBrowserTitle(name);

    // OS-level browser notification (independent of in-app notifications)
    if (this.getSetting('browserNotifications') && Notification.permission === 'granted') {
      new Notification('CWM', {
        body: `${name} is ready for input`,
        icon: '/favicon.ico',
      });
    }
  }
```

**Step 3: Verify manually**

1. Ensure "Browser Notifications" is ON and permission is granted
2. Open two terminal panes, switch to pane 2 so pane 1 is background
3. Wait for pane 1 to go idle (Claude finishes)
4. OS notification should appear in the Windows notification corner
5. Toggle "Browser Notifications" OFF — notification should NOT fire on next idle

**Step 4: Commit**
```bash
git add src/web/public/app.js
git commit -m "feat: fire OS browser notification on terminal idle"
```

---

### Task 5: Final check

**Step 1: Confirm `browserNotifications` appears only where expected**

Run these searches and verify counts:
- `browserNotifications` should appear in 4 places: default, registry, change handler, `onTerminalIdle`

**Step 2: Smoke test the full flow**

1. Start the app
2. Open Settings — "Browser Notifications" toggle is OFF by default ✓
3. Toggle ON — browser permission prompt appears ✓
4. Allow — toggle stays on ✓
5. Open two panes, go idle on background pane — OS notification fires ✓
6. Toggle OFF — no more OS notifications on next idle ✓
7. Reload page — setting persists correctly from localStorage ✓

**Step 3: Final commit if any cleanup needed**
```bash
git add src/web/public/app.js
git commit -m "feat: browser notifications complete"
```
