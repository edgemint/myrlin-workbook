# Design: Project-Context-Aware New Session

**Date:** 2026-03-04
**Status:** Approved

## Problem

The Projects (Discovered) panel in the sidebar shows local Claude project directories. When a user wants to create a new session scoped to one of those projects, they must:

1. Click the global "New Session" button
2. Manually type the project name
3. Manually type the working directory path

There is no connection between the Projects panel and the session creation flow.

## Solution

Two complementary mechanisms for pre-filling the New Session modal from project context, plus persistent per-project default directory storage.

---

## Feature 1: Per-Project `+` Button

A small `+` button added to each project accordion header in the Discovered panel.

- Hidden by default, shown on hover (CSS)
- Clicking it opens the full `createSession()` modal pre-filled with:
  - **Name:** project display name (derived from `realPath`)
  - **Working Dir:** project's saved `defaultDir` (from `projectDefaults`) — empty if none set

## Feature 2: Global Button Tracks Last-Selected Project

Clicking any project header in the sidebar sets `state.activeProjectContext`:

```js
{
  name: string,       // display name
  realPath: string,   // e.g. C:\Users\PC\.claude\projects\...
  encodedName: string,
  defaultDir: string, // from projectDefaults, may be empty
}
```

When `#create-session-btn` fires and `activeProjectContext` is set, Name and Working Dir are pre-filled from it. Context clears after use (or on workspace switch).

## Feature 3: Project Default Directory

Each project can have a saved `defaultDir` — a working directory override separate from `realPath`.

### Storage

New key in `state/workspaces.json`:

```json
{
  "projectDefaults": {
    "<encodedName>": { "defaultDir": "C:/Projects/my-app" }
  }
}
```

### API

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/project-defaults` | Returns full `projectDefaults` map |
| `PUT` | `/api/project-defaults/:encodedName` | Sets `defaultDir` for a project |

### UX

"Set Default Directory" added to project right-click context menu. Opens a prompt modal for the path (same browse button injection pattern as New Session modal).

---

## Modified Interfaces

### `createSession(opts = {})`

Extended to accept optional pre-fills:

```js
createSession({ name: 'my-app', workingDir: 'C:/Projects/my-app' })
```

Pre-filled values populate the form fields but remain editable. Empty strings = no pre-fill.

---

## Files Changed

| File | Change |
|------|--------|
| `src/state/store.js` | Add `projectDefaults: {}` to initial schema; add `getProjectDefaults()` and `setProjectDefault(encodedName, { defaultDir })` |
| `src/web/server.js` | `GET /api/project-defaults`, `PUT /api/project-defaults/:encodedName` |
| `src/web/public/app.js` | `activeProjectContext` in state; load defaults on init; click tracking on project headers; `+` button in `renderProjects()`; "Set Default Directory" in context menu; modified `createSession(opts)` |
| `src/web/public/styles.css` | `.project-new-session-btn` — hidden by default, visible on `.project-accordion-header:hover` |

---

## Non-Goals

- No changes to TUI (terminal UI) — web only
- No auto-create (always opens modal, never skips it)
- No change to how projects are discovered or stored
