# Notifications Menu Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a persistent notifications menu with bell icon, unread badge, and overlay panel to the web GUI header.

**Architecture:** Client-side only. Notifications are captured at toast-creation time into a `_notifications[]` array on the CWMApp instance. Read/unread state tracked via a `Set` of read IDs. Both persisted to localStorage. The overlay follows the exact same pattern as Session Manager and Conflict Center overlays.

**Tech Stack:** Vanilla JS, CSS (same as existing codebase — no new dependencies)

---

### Task 1: Add notification bell button and overlay HTML

**Files:**
- Modify: `src/web/public/index.html:222-245` (between conflict indicator section and quick switcher button)

**Step 1: Add the bell button and overlay markup**

Insert after the conflict center overlay closing `</div>` (line 244) and before the quick switcher button (line 246):

```html
        <!-- Notification Center -->
        <button class="btn btn-ghost btn-icon notification-bell" id="notification-bell-btn" title="Notifications">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 1.5a4 4 0 00-4 4v2.7L2.7 10.3a.5.5 0 00.3.9h10a.5.5 0 00.3-.9L12 8.2V5.5a4 4 0 00-4-4z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>
            <path d="M6 11.5a2 2 0 004 0" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          </svg>
          <span class="notification-badge" id="notification-badge" hidden>0</span>
        </button>

        <!-- Notification Center Overlay -->
        <div class="notification-center-overlay" id="notification-center-overlay" hidden>
          <div class="notification-center-header">
            <h3>Notifications</h3>
            <div class="notification-center-actions">
              <button class="btn btn-ghost btn-sm" id="notif-mark-all-read-btn">Mark all as read</button>
              <button class="btn btn-ghost btn-icon btn-sm" id="notif-close-btn" title="Close">&times;</button>
            </div>
          </div>
          <div class="notification-center-list" id="notification-center-list"></div>
        </div>
```

**Step 2: Commit**

```bash
git add src/web/public/index.html
git commit -m "feat(notifications): add bell button and overlay HTML to header"
```

---

### Task 2: Add CSS for notification bell, badge, and overlay

**Files:**
- Modify: `src/web/public/styles.css` (append after conflict center styles, around line 8240)

**Step 1: Add notification center styles**

Append these styles (modeled on `.conflict-indicator`, `.conflict-badge`, `.conflict-center-overlay`):

```css
/* ═══════════════════════════════════════════════════════════
   NOTIFICATION CENTER
   ═══════════════════════════════════════════════════════════ */

.notification-bell {
  position: relative;
  color: var(--text-secondary);
}

.notification-bell:hover { color: var(--text-primary); }

.notification-badge {
  position: absolute;
  top: -2px;
  right: -2px;
  min-width: 16px;
  height: 16px;
  border-radius: 8px;
  background: var(--blue);
  color: var(--base);
  font-size: 10px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
  line-height: 1;
}

.notification-center-overlay {
  position: fixed;
  top: 48px;
  right: 160px;
  width: 400px;
  max-height: 70vh;
  background: var(--mantle);
  border: 1px solid var(--surface0);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: sm-slide-in 0.15s ease-out;
}

.notification-center-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--surface0);
  flex-shrink: 0;
}

.notification-center-header h3 {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  margin: 0;
}

.notification-center-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.notification-center-list {
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.notification-center-list::-webkit-scrollbar { width: 6px; }
.notification-center-list::-webkit-scrollbar-track { background: transparent; }
.notification-center-list::-webkit-scrollbar-thumb { background: var(--surface1); border-radius: 3px; }

.notif-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--surface0);
  cursor: default;
  transition: background 0.1s;
}

.notif-item:hover {
  background: var(--surface0);
}

.notif-item.notif-clickable {
  cursor: pointer;
}

.notif-item.notif-unread {
  background: color-mix(in srgb, var(--blue) 8%, transparent);
}

.notif-item.notif-unread:hover {
  background: color-mix(in srgb, var(--blue) 14%, transparent);
}

.notif-item-icon {
  flex-shrink: 0;
  margin-top: 1px;
}

.notif-item-icon.notif-info { color: var(--blue); }
.notif-item-icon.notif-success { color: var(--green); }
.notif-item-icon.notif-warning { color: var(--yellow); }
.notif-item-icon.notif-error { color: var(--red); }

.notif-item-body {
  flex: 1;
  min-width: 0;
}

.notif-item-message {
  font-size: 13px;
  color: var(--text);
  line-height: 1.4;
  word-break: break-word;
}

.notif-item-time {
  font-size: 11px;
  color: var(--overlay0);
  margin-top: 2px;
}

.notif-item-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--blue);
  margin-top: 5px;
}

.notif-item:not(.notif-unread) .notif-item-dot {
  visibility: hidden;
}

.notif-empty {
  padding: 32px 16px;
  text-align: center;
  color: var(--overlay0);
  font-size: 13px;
}

@media (max-width: 768px) {
  .notification-center-overlay {
    right: 8px;
    left: 8px;
    width: auto;
  }
}
```

**Step 2: Commit**

```bash
git add src/web/public/styles.css
git commit -m "feat(notifications): add notification center CSS"
```

---

### Task 3: Wire up notification data model and localStorage persistence

**Files:**
- Modify: `src/web/public/app.js`
  - Constructor area (~line 141-144): Initialize `_notifications` array and load from localStorage
  - `els` object (~line 472-478): Add notification center DOM references

**Step 1: Add initialization after the `_wsCollapseState` load (line 144)**

```javascript
    // Load persisted notification center state
    this._notifications = [];
    this._notifIdCounter = 0;
    try {
      this._notifications = JSON.parse(localStorage.getItem('cwm_notifications') || '[]');
      this._notifIdCounter = this._notifications.reduce((max, n) => Math.max(max, n.id || 0), 0);
    } catch (_) { this._notifications = []; }
    this._notifCenterOpen = false;
```

**Step 2: Add element references after the conflict center els (after line 478)**

```javascript
      // Notification Center
      notificationBellBtn: document.getElementById('notification-bell-btn'),
      notificationBadge: document.getElementById('notification-badge'),
      notificationCenterOverlay: document.getElementById('notification-center-overlay'),
      notificationCenterList: document.getElementById('notification-center-list'),
      notifMarkAllReadBtn: document.getElementById('notif-mark-all-read-btn'),
      notifCloseBtn: document.getElementById('notif-close-btn'),
```

**Step 3: Commit**

```bash
git add src/web/public/app.js
git commit -m "feat(notifications): add data model and DOM refs"
```

---

### Task 4: Add notification center methods (push, toggle, render, mark-read)

**Files:**
- Modify: `src/web/public/app.js` — add a new section after the TOASTS section (after `dismissToast` at line 7689)

**Step 1: Add the notification center methods**

Insert after `dismissToast` method (after line 7689), before the SSE section:

```javascript

  /* ═══════════════════════════════════════════════════════════
     NOTIFICATION CENTER
     ═══════════════════════════════════════════════════════════ */

  /**
   * Push a notification into the persistent notification center list.
   * @param {string} message - Notification text
   * @param {'info'|'success'|'warning'|'error'} level - Severity
   * @param {string|null} sessionId - Optional session ID for "go to session" action
   */
  _pushNotification(message, level = 'info', sessionId = null) {
    const notif = {
      id: ++this._notifIdCounter,
      message,
      level,
      sessionId: sessionId || null,
      timestamp: Date.now(),
      read: false,
    };
    this._notifications.push(notif);
    // Trim to 100 max
    if (this._notifications.length > 100) {
      this._notifications = this._notifications.slice(-100);
    }
    this._persistNotifications();
    this._updateNotificationBadge();
    if (this._notifCenterOpen) this._renderNotificationCenter();
  }

  /**
   * Mark a single notification as read by ID.
   */
  _markNotificationRead(id) {
    const notif = this._notifications.find(n => n.id === id);
    if (notif && !notif.read) {
      notif.read = true;
      this._persistNotifications();
      this._updateNotificationBadge();
      if (this._notifCenterOpen) this._renderNotificationCenter();
    }
  }

  /**
   * Mark all notifications as read.
   */
  _markAllNotificationsRead() {
    let changed = false;
    for (const n of this._notifications) {
      if (!n.read) { n.read = true; changed = true; }
    }
    if (changed) {
      this._persistNotifications();
      this._updateNotificationBadge();
      if (this._notifCenterOpen) this._renderNotificationCenter();
    }
  }

  /**
   * Persist notifications to localStorage.
   */
  _persistNotifications() {
    try {
      localStorage.setItem('cwm_notifications', JSON.stringify(this._notifications));
    } catch (_) { /* quota exceeded — ignore */ }
  }

  /**
   * Update the badge count on the bell icon.
   */
  _updateNotificationBadge() {
    const unread = this._notifications.filter(n => !n.read).length;
    if (this.els.notificationBadge) {
      this.els.notificationBadge.textContent = unread > 99 ? '99+' : String(unread);
      this.els.notificationBadge.hidden = unread === 0;
    }
  }

  /**
   * Toggle the notification center overlay.
   */
  toggleNotificationCenter() {
    if (this._notifCenterOpen) {
      this.closeNotificationCenter();
    } else {
      this.openNotificationCenter();
    }
  }

  /**
   * Open the notification center overlay.
   */
  openNotificationCenter() {
    this._notifCenterOpen = true;
    if (this.els.notificationCenterOverlay) {
      this.els.notificationCenterOverlay.hidden = false;
    }
    this._renderNotificationCenter();

    this._notifOutsideHandler = (e) => {
      if (this.els.notificationCenterOverlay && !this.els.notificationCenterOverlay.hidden &&
          !this.els.notificationCenterOverlay.contains(e.target) &&
          !e.target.closest('.notification-bell')) {
        this.closeNotificationCenter();
      }
    };
    setTimeout(() => document.addEventListener('click', this._notifOutsideHandler), 0);
  }

  /**
   * Close the notification center overlay.
   */
  closeNotificationCenter() {
    this._notifCenterOpen = false;
    if (this.els.notificationCenterOverlay) {
      this.els.notificationCenterOverlay.hidden = true;
    }
    document.removeEventListener('click', this._notifOutsideHandler);
  }

  /**
   * Render the notification center list.
   */
  _renderNotificationCenter() {
    const list = this.els.notificationCenterList;
    if (!list) return;

    if (this._notifications.length === 0) {
      list.innerHTML = '<div class="notif-empty">No notifications yet</div>';
      return;
    }

    const icons = {
      info: '<svg width="16" height="16" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M9 8v4M9 6v.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
      success: '<svg width="16" height="16" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M6 9.5l2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      warning: '<svg width="16" height="16" viewBox="0 0 18 18" fill="none"><path d="M9 2l7.5 13H1.5L9 2z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9 7.5v3M9 12.5v.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
      error: '<svg width="16" height="16" viewBox="0 0 18 18" fill="none"><circle cx="9" cy="9" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M6.5 6.5l5 5M11.5 6.5l-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    };

    // Render newest first
    const sorted = [...this._notifications].reverse();
    list.innerHTML = sorted.map(n => {
      const isClickable = !!n.sessionId;
      return `<div class="notif-item${n.read ? '' : ' notif-unread'}${isClickable ? ' notif-clickable' : ''}" data-notif-id="${n.id}"${isClickable ? ` data-session-id="${this.escapeHtml(n.sessionId)}"` : ''}>
        <span class="notif-item-icon notif-${n.level}">${icons[n.level] || icons.info}</span>
        <div class="notif-item-body">
          <div class="notif-item-message">${this.escapeHtml(n.message)}</div>
          <div class="notif-item-time">${this.relativeTime(n.timestamp)}</div>
        </div>
        <span class="notif-item-dot"></span>
      </div>`;
    }).join('');

    // Click handlers
    list.querySelectorAll('.notif-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = parseInt(el.dataset.notifId, 10);
        this._markNotificationRead(id);
        const sid = el.dataset.sessionId;
        if (sid) {
          const slotIdx = this.terminalPanes
            ? this.terminalPanes.findIndex(tp => tp && tp.sessionId === sid)
            : -1;
          this._navigateToSession(sid, slotIdx);
          this.closeNotificationCenter();
        }
      });
    });
  }
```

**Step 2: Commit**

```bash
git add src/web/public/app.js
git commit -m "feat(notifications): add notification center methods"
```

---

### Task 5: Wire up event listeners and integrate with existing toasts

**Files:**
- Modify: `src/web/public/app.js`
  - Event listener setup area (~line 805-820): Add bell button, close button, mark-all-read listeners
  - Escape key handler (~line 1052): Add notification center close on Escape
  - `showToast` (~line 7529): Add `_pushNotification` call with a `_notifSessionId` context param
  - `showActionToast` (~line 7604): Add `_pushNotification` call; mark read on action/close click
  - SSE handler `session:notification` case (~line 7769): Pass `sessionId` to push
  - Completion handler (~line 10145): Pass `sessionId` to push
  - Init badge on load: Call `_updateNotificationBadge()` at end of init

**Step 1: Add event listeners after the conflict button listeners (after ~line 818)**

```javascript
    // Notification Center
    if (this.els.notificationBellBtn) {
      this.els.notificationBellBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleNotificationCenter();
      });
    }
    if (this.els.notifCloseBtn) {
      this.els.notifCloseBtn.addEventListener('click', () => this.closeNotificationCenter());
    }
    if (this.els.notifMarkAllReadBtn) {
      this.els.notifMarkAllReadBtn.addEventListener('click', () => this._markAllNotificationsRead());
    }
```

**Step 2: Add Escape key support**

In the Escape key handler (around line 1052), add before the existing session manager check:

```javascript
        } else if (this.els.notificationCenterOverlay && !this.els.notificationCenterOverlay.hidden) {
          this.closeNotificationCenter();
```

**Step 3: Integrate `_pushNotification` into SSE `session:notification` handler**

At line ~7776 (inside the `case 'session:notification'` block), add a `_pushNotification` call right before the toast:

```javascript
        // Push to notification center
        this._pushNotification(`${name}${wsName}: ${msg}`, 'info', d.sessionId || null);
```

**Step 4: Integrate `_pushNotification` into completion notification handler**

At line ~10157 (inside the completion notification block, before `showActionToast`), add:

```javascript
      // Push to notification center
      this._pushNotification(`${qualifiedName} is ready for input`, 'success', sessionId);
```

**Step 5: Update toast close/action to mark notification as read**

In `showActionToast`, when the action button or close button is clicked, we need to mark the corresponding notification as read. The simplest approach: store the notif ID on the toast DOM element.

After the `_pushNotification` call in both SSE handler and completion handler, capture the returned notif ID. Modify `_pushNotification` to return the notification ID. Then on the toast element, set `toast.dataset.notifId = id`. In the close and action handlers, call `this._markNotificationRead(parseInt(toast.dataset.notifId, 10))`.

Specifically, change `_pushNotification` to return the id:

```javascript
  _pushNotification(message, level = 'info', sessionId = null) {
    // ... existing code ...
    return notif.id;
  }
```

Then in the SSE handler, after pushing:
```javascript
        const notifId = this._pushNotification(`${name}${wsName}: ${msg}`, 'info', d.sessionId || null);
```

And wrap the `showActionToast` call to capture the toast element and tag it:
```javascript
        if (d.sessionId) {
          const toast = this.showActionToast(...);
          if (toast) toast.dataset.notifId = notifId;
        }
```

Similarly in the completion handler. Then in `dismissToast`, add:
```javascript
    if (toast.dataset.notifId) {
      this._markNotificationRead(parseInt(toast.dataset.notifId, 10));
    }
```

**Step 6: Call `_updateNotificationBadge()` at end of init**

After all event listeners are wired, add:
```javascript
    this._updateNotificationBadge();
```

**Step 7: Commit**

```bash
git add src/web/public/app.js
git commit -m "feat(notifications): wire up bell button, toast integration, and event listeners"
```

---

### Task 6: Add to feature catalog and Escape key chain

**Files:**
- Modify: `src/web/public/app.js`
  - `getFeatureCatalog()` (~line 3838): Add notification center entry

**Step 1: Add catalog entry**

```javascript
      {
        id: 'notification-center',
        name: 'Notification Center',
        description: 'View recent notifications and mark them as read',
        category: 'action',
        tags: ['notifications', 'bell', 'alerts', 'unread'],
        icon: '&#128276;',
        action: () => this.toggleNotificationCenter(),
      },
```

**Step 2: Commit**

```bash
git add src/web/public/app.js
git commit -m "feat(notifications): add notification center to feature catalog"
```

---

### Task 7: Manual testing and final commit

**Step 1: Test checklist**
- Bell icon visible in header between conflict indicator and search
- Badge hidden when 0 unread
- Trigger a completion notification → badge shows "1", toast appears
- Click bell → overlay opens with the notification (blue unread background, blue dot)
- Click the notification item → navigates to session, notification marked as read
- Close overlay, trigger more notifications → badge count increments
- Open overlay → "Mark all as read" clears all unread styling, badge disappears
- Close toast via X → corresponding notification marked as read
- Click "Go to session" on toast → corresponding notification marked as read
- Escape key closes overlay
- Click outside closes overlay
- Page reload → notifications persist from localStorage
- Empty state shows "No notifications yet" when list is empty

**Step 2: Final commit if any tweaks needed**

```bash
git add -A
git commit -m "feat(notifications): notification center with bell icon, unread badge, and overlay panel"
```
