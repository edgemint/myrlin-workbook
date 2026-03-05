# Design: Register Discovered Sessions on Open

**Date:** 2026-03-05
**Status:** Approved

## Problem

Sessions opened from the Discovered panel (sidebar project accordion) are launched directly into terminal panes via `openTerminalInPane` without creating a record in `state.sessions`. As a result, they are invisible to the Ctrl+K quick switcher and the session list, even though active terminal tabs exist for them.

## Goal

When a user opens a session from the Discovered panel, automatically register it as a managed session under the appropriate workspace so it appears in Ctrl+K and the session list.

## Entry Points Affected

Three code paths open discovered sessions without registering them:

1. **Click on `.project-session-item`** (~line 1789) — click handler in the Discovered panel
2. **`openConversationResult`** (~line 8821) — used by Find Conversation feature
3. **D&D drop of `cwm/project-session`** (~line 8950) — dragging a session onto a terminal pane

## Design

### New helper: `findOrCreateWorkspaceForDir(dir)`

Extracted from the existing launcher logic (lines 15719–15741 in `app.js`). Logic:

1. Search `state.allSessions` for any session whose `workingDir` matches `dir` (case-insensitive, normalised slashes). If found, return that session's `workspaceId`.
2. Fall back to name-matching: find a workspace whose `name` matches the last path segment of `dir`.
3. If nothing matches, call `POST /api/workspaces` to create one named after the folder, then `loadWorkspaces()`.
4. Return `workspaceId`.

### New helper: `ensureSessionRegistered(claudeUUID, displayName, projectPath)`

1. Check `state.allSessions` for an existing session with `resumeSessionId === claudeUUID`. If found, return it immediately (idempotent — no duplicate on re-open).
2. Call `findOrCreateWorkspaceForDir(projectPath)` to get a `workspaceId`.
3. Resolve display name: prefer `getProjectSessionTitle(claudeUUID)` (stored/custom name) over `displayName` fallback.
4. Call `POST /api/sessions` with `{ name, workspaceId, workingDir: projectPath, resumeSessionId: claudeUUID, command: 'claude' }`.
5. Call `loadSessions()` + `loadStats()` to sync client state.
6. Return the new session record.

### Entry point changes

Each of the three entry points is updated to:

1. Call `await ensureSessionRegistered(claudeUUID, fallbackName, projectPath)` before opening the pane.
2. Pass the returned managed session's `id` (not the raw Claude UUID) to `openTerminalInPane`, so the pane is tracked under the registered session like any other managed session.

### What is NOT changed

- Dropping a whole project (`cwm/project`) — starts a fresh session, already handled by the launcher.
- The Discover modal import flow — already creates proper session records.
- Server-side code — all changes are in `src/web/public/app.js`.

## Result

Opening anything from the Discovered panel auto-creates (or reuses) a session record and workspace. Those sessions immediately appear in Ctrl+K and the session list under the correct workspace.
