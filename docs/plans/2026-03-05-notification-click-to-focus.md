# Notification Click-to-Focus Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Clicking an in-app completion toast navigates to the finished terminal pane; clicking a browser (OS) notification focuses the window and navigates there too.

**Architecture:** Add a `showActionToast` method alongside the existing `showToast` that renders an extra "Go to session" button. Add a `_navigateToSession` helper that resolves the terminal group and pane slot for any session ID and switches to it. Wire both into `onTerminalIdle` alongside the existing `new Notification(...)` call.

**Tech Stack:** Vanilla JS (ES6+), CSS custom properties. All changes are in two files: `src/web/public/app.js` and `src/web/public/styles.css`.

---

### Task 1: Add `.toast-action` CSS

**Files:**
- Modify: `src/web/public/styles.css` — after the `.toast-close:hover` block (~line 2625)

**Step 1: Open styles.css and locate the insertion point**

Find the block ending:
```css
.toast-close:hover {
  color: var(--text-primary);
  background: var(--surface1);
}
```

**Step 2: Insert the new rule immediately after that block**

```css
.toast-action {
  background: none;
  border: 1px solid var(--border-subtle);
  color: var(--text-secondary);
  cursor: pointer;
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-family: inherit;
  transition: all var(--transition-fast);
  flex-shrink: 0;
  white-space: nowrap;
}

.toast-action:hover {
  color: var(--text-primary);
  background: var(--surface1);
  border-color: var(--border-default);
}
```

**Step 3: Verify visually**

Open the app in the browser, open DevTools console, and run:
```js
app.showToast('Test message', 'success');
```
The existing toast should look exactly the same (no action button). No regressions.

**Step 4: Commit**

```bash
git add src/web/public/styles.css
git commit -m "style(toast): add toast-action button styles"
```

---

### Task 2: Add `showActionToast` method

**Files:**
- Modify: `src/web/public/app.js` — directly after the `showToast` method body (~line 7302)

**Step 1: Find the right insertion point**

Search for the `dismissToast` method (it immediately follows `showToast`). Insert the new method between them.

**Step 2: Add the method**

```js
/**
 * Show a toast with an additional action button.
 * @param {string} message - Toast body text
 * @param {'info'|'success'|'warning'|'error'} level - Severity
 * @param {string} actionLabel - Button label (e.g. "Go to session")
 * @param {Function} onAction - Called when the action button is clicked
 */
showActionToast(message, level = 'info', actionLabel = 'Go', onAction = null) {
  const icons = {
    info: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M9 8v4M9 6v.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    success: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M6 9.5l2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    warning: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 2l7.5 13H1.5L9 2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 7.5v3M9 12.5v.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    error: '<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M6.5 6.5l5 5M11.5 6.5l-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  };

  const toast = document.createElement('div');
  toast.className = `toast toast-${level}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[level] || icons.info}</span>
    <span class="toast-message">${this.escapeHtml(message)}</span>
    ${onAction ? `<button class="toast-action" type="button">${this.escapeHtml(actionLabel)}</button>` : ''}
    <button class="toast-close" aria-label="Dismiss">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    </button>
  `;

  toast.querySelector('.toast-close').addEventListener('click', () => this.dismissToast(toast));

  if (onAction) {
    toast.querySelector('.toast-action').addEventListener('click', () => {
      onAction();
      this.dismissToast(toast);
    });
  }

  // Swipe-to-dismiss (same as showToast)
  let startX = 0, currentX = 0, dragging = false;
  const closeBtn = toast.querySelector('.toast-close');
  const actionBtn = toast.querySelector('.toast-action');
  const onPointerDown = (e) => {
    if (closeBtn && closeBtn.contains(e.target)) return;
    if (actionBtn && actionBtn.contains(e.target)) return;
    startX = e.clientX;
    currentX = 0;
    dragging = true;
    toast.classList.add('toast-dragging');
    toast.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!dragging) return;
    currentX = e.clientX - startX;
    if (currentX > 0) toast.style.transform = `translateX(${currentX}px)`;
  };
  const onPointerUp = () => {
    if (!dragging) return;
    dragging = false;
    toast.classList.remove('toast-dragging');
    toast.style.transform = '';
    if (currentX > 80) {
      toast.classList.add('toast-swipe-exit');
      setTimeout(() => toast.remove(), 200);
    }
  };
  toast.addEventListener('pointerdown', onPointerDown);
  toast.addEventListener('pointermove', onPointerMove);
  toast.addEventListener('pointerup', onPointerUp);
  toast.addEventListener('pointercancel', onPointerUp);

  const container = document.querySelector('.toast-container');
  if (container) container.appendChild(toast);

  // Auto-dismiss after 8 seconds (longer than plain toast to give time to click)
  setTimeout(() => {
    if (toast.parentNode) this.dismissToast(toast);
  }, 8000);

  return toast;
}
```

**Step 3: Verify in browser console**

```js
app.showActionToast('Test session is ready', 'success', 'Go to session', () => console.log('navigated!'));
```

Expected: toast appears with message + "Go to session" button + close button. Clicking "Go to session" logs to console and dismisses the toast. Swipe-to-dismiss still works. Auto-dismiss after 8s.

**Step 4: Commit**

```bash
git add src/web/public/app.js
git commit -m "feat(toast): add showActionToast with action button"
```

---

### Task 3: Add `_navigateToSession` helper

**Files:**
- Modify: `src/web/public/app.js` — inside the `TERMINAL COMPLETION NOTIFICATIONS` section, after `_highlightTabGroupForSession` (~line 9808)

**Step 1: Find insertion point**

Find `_highlightTabGroupForSession` and the closing `}` of that method. Insert immediately after.

**Step 2: Add the helper**

```js
/**
 * Navigate the UI to the terminal pane for a given session.
 * Switches to terminal view, switches tab groups if needed,
 * and focuses the specific pane slot.
 * @param {string} sessionId
 * @param {number} activeSlotIdx - Index in this.terminalPanes (-1 if not in active group)
 */
_navigateToSession(sessionId, activeSlotIdx) {
  // Ensure terminal view is visible
  if (this.state.viewMode !== 'terminal') {
    this.setViewMode('terminal');
  }

  // Session is already in the active group — just focus its pane
  if (activeSlotIdx !== -1) {
    this.setActiveTerminalPane(activeSlotIdx);
    return;
  }

  // Session is in a different tab group — find and switch to it
  if (!this._tabGroups) return;
  for (const group of this._tabGroups) {
    if (group.id === this._activeGroupId) continue;
    const paneEntry = (group.panes || []).find(p => p && p.sessionId === sessionId);
    if (paneEntry) {
      this.switchTerminalGroup(group.id);
      // Wait one frame for the group switch to restore pane DOM before focusing
      requestAnimationFrame(() => {
        this.setActiveTerminalPane(paneEntry.slot);
      });
      return;
    }
  }
}
```

**Step 3: Verify in browser console**

With at least two terminal panes open (possibly in different tab groups), run:
```js
// Replace with a real sessionId from app.state.sessions
const sid = app.state.sessions[0]?.id;
app._navigateToSession(sid, -1);
```
Expected: if the session is in a non-active group, the tab switches. If not found, nothing crashes.

**Step 4: Commit**

```bash
git add src/web/public/app.js
git commit -m "feat(terminal): add _navigateToSession helper"
```

---

### Task 4: Wire navigation into `onTerminalIdle`

**Files:**
- Modify: `src/web/public/app.js` — the `onTerminalIdle` method (~line 9682)

**Step 1: Locate `onTerminalIdle`**

Find:
```js
onTerminalIdle({ sessionId, sessionName }) {
```

**Step 2: Replace the toast call and browser notification block**

Find this section (inside the `if (this.getSetting('completionNotifications') && ...)` block):
```js
      // Show toast
      this.showToast(`${qualifiedName} is ready for input`, 'success');
```

Replace with:
```js
      // Show toast with navigation action
      this.showActionToast(
        `${qualifiedName} is ready for input`,
        'success',
        'Go to session',
        () => this._navigateToSession(sessionId, sessionIdx)
      );
```

**Step 3: Wire the browser notification onclick**

Find the browser notification block:
```js
    if (this.getSetting('browserNotifications') && Notification.permission === 'granted' && (document.hidden || !document.hasFocus())) {
      new Notification('CWM', {
        body: `${qualifiedName} is ready for input`,
        icon: '/favicon.ico',
      });
    }
```

Replace with:
```js
    if (this.getSetting('browserNotifications') && Notification.permission === 'granted' && (document.hidden || !document.hasFocus())) {
      const notif = new Notification('CWM', {
        body: `${qualifiedName} is ready for input`,
        icon: '/favicon.ico',
      });
      notif.onclick = () => {
        window.focus();
        this._navigateToSession(sessionId, sessionIdx);
      };
    }
```

**Step 4: Verify end-to-end**

Manual test checklist:
1. Open two terminal panes in the same tab group. Let one finish. The toast shows "Go to session" — clicking it focuses that pane.
2. Open panes in two different tab groups. Let a background-group pane finish. The toast "Go to session" switches to the correct tab group.
3. Open the app, trigger a completion while the browser window is unfocused (enable Browser Notifications in Settings). Click the OS notification — the window focuses and the terminal pane is active.
4. Confirm existing swipe-to-dismiss and auto-dismiss on toasts still work.
5. Confirm sessions in the active pane slot (completionNotifications gated check already prevents toast) don't generate spurious navigations.

**Step 5: Commit**

```bash
git add src/web/public/app.js
git commit -m "feat(notifications): navigate to session on toast/browser notification click"
```
