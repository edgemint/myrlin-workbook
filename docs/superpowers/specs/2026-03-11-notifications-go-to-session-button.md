# Notifications: Add "Go to Session" Button

**Date:** 2026-03-11
**Status:** Design approved

## Overview

Add an explicit "Go to session" button to the notification center menu (top right, bell icon) that replaces the current implicit click-to-navigate behavior. Users will only navigate by clicking the button, not by clicking the notification itself.

## Requirements

- Add a "Go to session" button inline on the right side of each notification (only for notifications with `sessionId`)
- **Notifications with `sessionId`:** Button click navigates to session, marks as read, closes notification center
- **Notifications without `sessionId`:** Clicking the notification marks it as read (no navigation, keep unread dot indicator)
- Button styling: small inline button matching app design patterns
- Remove the `notif-clickable` class from all notification items

## Implementation Details

### 1. HTML Structure
**File:** `src/web/public/app.js`, method `_renderNotificationCenter()` (lines 7625–7678)

Conditional rendering based on `sessionId`:

```html
<!-- For notifications WITH sessionId: -->
<button class="notif-go-to-btn" title="Go to this session">Go to session</button>

<!-- For notifications WITHOUT sessionId: -->
<span class="notif-item-dot"></span>
```

### 2. Refactor Click Handlers
Replace the current single click handler on `.notif-item` with two separate handlers:

**For notifications with `sessionId`:** Button click handler on `.notif-go-to-btn` that:
1. Finds the pane by `sessionId` (reuse `_findPaneBySessionId()`)
2. Navigates to the pane (switch group if needed, set active pane)
3. Marks notification as read
4. Closes notification center
5. Sets view mode to 'terminal' if not already

**For notifications without `sessionId`:** Click handler on `.notif-item` that:
1. Marks notification as read
2. Does not navigate or close the notification center

### 4. CSS Styling
**File:** `src/web/public/styles.css`

Add styles for `.notif-go-to-btn`:
- Inline button appearance (background, text color, padding)
- Hover state
- Active/focus states
- Small font size to fit notification layout

Also update `.notif-item` to have `cursor: pointer` (since all notifications are now clickable).

Example approach:
```css
.notif-item {
  cursor: pointer;  /* Update: all notifications are clickable */
}

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
```

### 5. Data Structure
No changes to notification data structure. Existing `n.sessionId` field is already present and used.

## Files to Modify

- `src/web/public/app.js` — `_renderNotificationCenter()` method
- `src/web/public/styles.css` — Add `.notif-go-to-btn` styles

## Testing

**Notifications with `sessionId`:**
- Verify "Go to session" button appears
- Verify clicking button navigates to the session
- Verify notification is marked as read
- Verify notification center closes after navigation
- Verify view mode switches to 'terminal'

**Notifications without `sessionId`:**
- Verify no button appears, only the unread dot
- Verify clicking notification marks it as read
- Verify notification center stays open after clicking
- Verify no navigation occurs

## Edge Cases

- Session no longer exists — `_findPaneBySessionId()` returns null, button click is no-op (graceful, notification still marked as read)
- Notification without `sessionId` — No button rendered, unread dot shows, clicking marks as read
- Multiple terminals open — Navigate to correct group/pane
- Button click should not bubble to notification item handler (use `event.stopPropagation()` on button handler)
