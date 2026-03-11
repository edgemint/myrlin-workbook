# Notifications: Add "Go to Session" Button Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit "Go to session" button to the notification center for notifications with sessionId, while enabling "mark as read" clicks for all notifications.

**Architecture:** Refactor the notification rendering and click handling logic. Conditional rendering outputs either a "Go to session" button (for notifications with sessionId) or an unread dot (for all others). Two separate click handlers: one for the button (navigate + mark read + close), one for the notification item (mark read only).

**Tech Stack:** Vanilla JavaScript, Blessed HTML/CSS, no new dependencies

---

## File Structure

**Modified Files:**
- `src/web/public/app.js` — `_renderNotificationCenter()` method (lines 7625–7678)
- `src/web/public/styles.css` — Add `.notif-go-to-btn` styles and update `.notif-item`

**No new files created.**

---

## Chunk 1: CSS Styling

### Task 1: Add Button CSS Styles

**Files:**
- Modify: `src/web/public/styles.css`

- [ ] **Step 1: Locate the notification item CSS block**

Open `src/web/public/styles.css` and find the `.notif-item` rule (around line 8330).

- [ ] **Step 2: Update `.notif-item` cursor property**

Find this line:
```css
.notif-item {
  cursor: default;
```

Replace with:
```css
.notif-item {
  cursor: pointer;
```

This makes all notifications clickable (currently they're only clickable when they have sessionId).

- [ ] **Step 3: Remove or update `.notif-clickable` selector**

Find this rule (around line 8337):
```css
.notif-item.notif-clickable {
  cursor: pointer;
}
```

Delete this entire rule since `.notif-item` now has `cursor: pointer` by default. The `notif-clickable` class will no longer be added to the HTML.

- [ ] **Step 4: Add `.notif-go-to-btn` styles**

Find the last notification-related CSS rule (around line 8350). Add these new styles after it:

```css
.notif-go-to-btn {
  padding: 4px 12px;
  font-size: 11px;
  background: var(--blue);
  color: var(--base);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.1s;
  flex-shrink: 0;
}

.notif-go-to-btn:hover {
  background: color-mix(in srgb, var(--blue) 120%, transparent);
}

.notif-go-to-btn:active {
  opacity: 0.8;
}

.notif-go-to-btn:focus {
  outline: 2px solid var(--blue);
  outline-offset: 2px;
}
```

- [ ] **Step 5: Verify CSS syntax**

Check that the CSS is valid (no syntax errors). You can use browser devtools to verify.

- [ ] **Step 6: Commit**

```bash
git add src/web/public/styles.css
git commit -m "style: add notif-go-to-btn styles and update notif-item cursor"
```

---

## Chunk 2: HTML Rendering Logic

### Task 2: Refactor `_renderNotificationCenter()` HTML Template

**Files:**
- Modify: `src/web/public/app.js` (lines 7643–7653)

- [ ] **Step 1: Locate the HTML rendering code**

Open `src/web/public/app.js` and find the `list.innerHTML = sorted.map(n => {` block starting at line 7643.

- [ ] **Step 2: Update the notification item template**

Replace this section (lines 7643–7653):

```javascript
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
```

With:

```javascript
    // Render newest first
    const sorted = [...this._notifications].reverse();
    list.innerHTML = sorted.map(n => {
      const hasSession = !!n.sessionId;
      const rightContent = hasSession
        ? `<button class="notif-go-to-btn" title="Go to this session">Go to session</button>`
        : `<span class="notif-item-dot"></span>`;

      return `<div class="notif-item${n.read ? '' : ' notif-unread'}" data-notif-id="${n.id}"${hasSession ? ` data-session-id="${this.escapeHtml(n.sessionId)}"` : ''}>
        <span class="notif-item-icon notif-${n.level}">${icons[n.level] || icons.info}</span>
        <div class="notif-item-body">
          <div class="notif-item-message">${this.escapeHtml(n.message)}</div>
          <div class="notif-item-time">${this.relativeTime(n.timestamp)}</div>
        </div>
        ${rightContent}
      </div>`;
    }).join('');
```

**What changed:**
- Removed `notif-clickable` class (no longer needed)
- Removed `isClickable` variable (renamed to `hasSession` for clarity)
- Conditional right content: button if has session, dot otherwise
- Template is cleaner and more maintainable

- [ ] **Step 3: Verify template renders correctly**

Visually check that the HTML structure looks correct (icon, body, then either button or dot on the right).

- [ ] **Step 4: Commit**

```bash
git add src/web/public/app.js
git commit -m "refactor: update notification item template with conditional button/dot"
```

---

## Chunk 3: Click Handlers

### Task 3: Refactor Click Handlers

**Files:**
- Modify: `src/web/public/app.js` (lines 7655–7677)

- [ ] **Step 1: Remove old click handler**

Delete the entire old click handler (lines 7655–7677):

```javascript
    // Click handlers
    list.querySelectorAll('.notif-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = parseInt(el.dataset.notifId, 10);
        this._markNotificationRead(id);
        const sid = el.dataset.sessionId;
        if (sid) {
          const paneLocation = this._findPaneBySessionId(sid);
          if (paneLocation) {
            if (paneLocation.groupId !== this._activeGroupId) {
              this._suppressFocusin = true;
              this.switchTerminalGroup(paneLocation.groupId);
              this.setActiveTerminalPane(paneLocation.slotIdx);
              this._suppressFocusin = false;
            } else {
              this.setActiveTerminalPane(paneLocation.slotIdx);
            }
            if (this.state.viewMode !== 'terminal') this.setViewMode('terminal');
          }
          this.closeNotificationCenter();
        }
      });
    });
```

- [ ] **Step 2: Add new click handlers**

In place of the old handler, add these two new handlers:

```javascript
    // Click handlers
    // Handler for notifications with sessionId: navigate to session
    list.querySelectorAll('.notif-go-to-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const notifEl = btn.closest('.notif-item');
        const id = parseInt(notifEl.dataset.notifId, 10);
        const sid = notifEl.dataset.sessionId;

        this._markNotificationRead(id);

        if (sid) {
          const paneLocation = this._findPaneBySessionId(sid);
          if (paneLocation) {
            if (paneLocation.groupId !== this._activeGroupId) {
              this._suppressFocusin = true;
              this.switchTerminalGroup(paneLocation.groupId);
              this.setActiveTerminalPane(paneLocation.slotIdx);
              this._suppressFocusin = false;
            } else {
              this.setActiveTerminalPane(paneLocation.slotIdx);
            }
            if (this.state.viewMode !== 'terminal') this.setViewMode('terminal');
          }
          this.closeNotificationCenter();
        }
      });
    });

    // Handler for all notifications: mark as read when clicking the item
    list.querySelectorAll('.notif-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = parseInt(el.dataset.notifId, 10);
        this._markNotificationRead(id);
      });
    });
```

**What changed:**
- New button handler: calls `e.stopPropagation()` to prevent bubbling to item handler, marks read, navigates, closes center
- Item handler simplified: just marks as read (no navigation, no closing)
- Button handler reuses the same navigation logic as before
- Both handlers coexist: button is inside item, so button handler fires first and prevents item handler

- [ ] **Step 3: Verify handler logic**

Walk through the code mentally:
- Clicking a button with sessionId: button handler fires, stops propagation, marks read, navigates, closes
- Clicking a notification item without sessionId: item handler fires, marks read, nothing else
- Clicking a notification item with sessionId but not on the button: both handlers fire, but button handler stopped propagation... wait, no. The button is inside the item. If you click the button, button handler fires first due to event bubbling, and `stopPropagation()` prevents the item handler from firing. If you click elsewhere on the item (not the button), only the item handler fires.

Actually, let me reconsider. The button is a child of the item. When you click the button:
1. Button click handler fires (inside the button)
2. Calls `stopPropagation()`, prevents bubbling to item
3. Item handler doesn't fire

When you click the item but not the button:
1. Item click handler fires
2. Button handler doesn't fire (click wasn't on the button)

This is correct.

- [ ] **Step 4: Commit**

```bash
git add src/web/public/app.js
git commit -m "refactor: split notification click handlers for button vs item"
```

---

## Chunk 4: Manual Testing

### Task 4: Test the Feature in Browser

**Files:**
- Test: `src/web/public/app.js` (runtime testing via browser)

- [ ] **Step 1: Start the server**

Ensure the CWM server is running:

```bash
npm start
```

Expected: Server starts on localhost with web UI accessible.

- [ ] **Step 2: Open the app in browser**

Navigate to the CWM web UI (typically `http://localhost:3000` or similar).

- [ ] **Step 3: Trigger notifications with sessionId**

Create or run a session that generates notifications (e.g., "Session started"). These should have a `sessionId` attached.

Expected: Open the notification center (bell icon, top right). Notifications with sessionId should have a blue "Go to session" button on the right.

- [ ] **Step 4: Test notification with sessionId**

Click the "Go to session" button on a notification with sessionId.

Expected:
- Notification is marked as read (background highlight goes away)
- Navigation to the session's terminal pane occurs (group/pane switches if needed)
- View mode changes to 'terminal' if not already
- Notification center closes

- [ ] **Step 5: Trigger notifications without sessionId**

Manually trigger a notification without a sessionId (if possible via code or by testing a scenario that doesn't attach sessionId).

Expected: Notification shows an unread dot on the right, no button.

- [ ] **Step 6: Test notification without sessionId**

Click on a notification without sessionId.

Expected:
- Notification is marked as read (background highlight goes away)
- No navigation occurs
- Notification center stays open
- No button action triggered

- [ ] **Step 7: Test unread indicators**

Create multiple notifications. Mark some as read by clicking.

Expected:
- Read notifications lose their blue background
- Unread notifications retain blue background
- Unread count in badge updates correctly

- [ ] **Step 8: Test edge case: session no longer exists**

If possible, trigger a notification for a session, then delete/close that session, then click the button.

Expected:
- Button click doesn't crash (no error in console)
- Notification is still marked as read
- No navigation occurs (gracefully handles missing pane)

- [ ] **Step 9: Verify CSS**

Visually check:
- Button has blue background
- Button has hover effect (lightens on hover)
- Button text is readable
- Button fits inline with the notification layout
- Button spacing/alignment looks right

- [ ] **Step 10: Open browser dev tools and check console**

Expected: No JavaScript errors related to notifications or click handlers.

---

## Chunk 5: Summary and Commit

### Task 5: Final Review and Commit

- [ ] **Step 1: Review all changes**

Summarize what was changed:

**CSS (`src/web/public/styles.css`):**
- Changed `.notif-item` cursor from `default` to `pointer`
- Removed `.notif-item.notif-clickable` rule
- Added `.notif-go-to-btn` button styles with hover and active states

**JavaScript (`src/web/public/app.js`):**
- Updated `_renderNotificationCenter()` template to render button for sessionId notifications, dot for others
- Removed `notif-clickable` class from HTML
- Replaced single click handler with two handlers: button handler (navigate) and item handler (mark read)

- [ ] **Step 2: Run final tests**

If automated tests exist for notifications, run them:

```bash
npm test -- notification
```

Expected: All tests pass (or new functionality is tested elsewhere).

- [ ] **Step 3: Final manual verification**

Open browser and confirm:
- Notifications with button render correctly
- Notifications with dot render correctly
- Both click behaviors work as expected
- No console errors

- [ ] **Step 4: Create final commit**

```bash
git add src/web/public/app.js src/web/public/styles.css
git commit -m "feat: add go-to-session button in notification center

- Add blue 'Go to session' button for notifications with sessionId
- Button navigates to session, marks as read, closes notification center
- Notifications without sessionId can be clicked to mark as read
- Update CSS: all notifications now have cursor:pointer
- Remove notif-clickable class as no longer needed"
```

- [ ] **Step 5: Verify commit**

```bash
git log --oneline -n 1
git diff HEAD~1
```

Expected: Last commit shows the feature branch with correct messages and file changes.

---

## Testing Checklist (for manual verification)

- [ ] Notifications with sessionId show "Go to session" button
- [ ] Clicking button navigates to the session
- [ ] Clicking button marks notification as read
- [ ] Clicking button closes the notification center
- [ ] View mode switches to 'terminal'
- [ ] Notifications without sessionId show unread dot
- [ ] Clicking notification without sessionId marks it as read
- [ ] Notification center stays open when clicking non-sessionId notification
- [ ] No navigation occurs for non-sessionId notifications
- [ ] Button has proper styling (blue, hover effect)
- [ ] Missing session (button click) is handled gracefully
- [ ] No JavaScript errors in console
- [ ] Unread badge updates correctly
- [ ] All existing functionality still works
