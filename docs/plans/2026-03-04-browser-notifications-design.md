# Browser Notifications — Design Doc
**Date:** 2026-03-04

## Overview

Add a new "Browser Notifications" setting that fires OS-level desktop notifications via the Web Notifications API when a background terminal session finishes. This is separate from the existing "Completion Notifications" setting (which handles in-app toast, sound, and border flash).

## New Setting

- **Key:** `browserNotifications`
- **Default:** `false`
- **Category:** Notifications
- **Label:** Browser Notifications
- **Description:** OS-level desktop notification when a background terminal finishes

## Permission Flow (Option A)

When the user toggles `browserNotifications` **ON**:
1. Call `Notification.requestPermission()`
2. If result is `"granted"` → save `true`, done
3. If result is `"denied"` or `"default"` → flip checkbox back off, save `false`, show toast: *"Browser notification permission was denied. Enable it in your browser settings."*

When toggled **OFF**: save `false` directly, no permission interaction.

## Notification Trigger

In `onTerminalIdle()`, after the existing in-app notification block, add an independent block:

```js
if (this.getSetting('browserNotifications') && Notification.permission === 'granted') {
  new Notification('CWM', {
    body: `${name} is ready for input`,
    icon: '/favicon.ico'
  });
}
```

- Fires regardless of which pane is active (user explicitly opted in to OS-level alerts)
- Independent of the `completionNotifications` setting

## What Does NOT Change

- `applySettings()` — no DOM/CSS changes needed
- Existing `completionNotifications` behavior — untouched
- `_playNotificationSound()` — untouched

## Files Changed

- `src/web/public/app.js`
  - Add `browserNotifications: false` to defaults in state initialization
  - Add entry to `getSettingsRegistry()`
  - Add permission-request logic in the settings change handler for `browserNotifications`
  - Add browser notification block in `onTerminalIdle()`
