# Unified Session Identity Design

**Date:** 2026-03-11
**Status:** Draft
**Area:** Core session management, hook integration, frontend pane identity

---

## Problem

The workspace manager currently maintains 6 separate maps and caches to track session identity:

| Structure | Location | Purpose |
|---|---|---|
| `sessions[id]` | Store | Managed sessions keyed by internal UUID |
| `sessionNames[claudeUUID]` | Store | Claude UUID → display name |
| `sessionNameSources[claudeUUID]` | Store | Tracks auto vs manual naming |
| `_liveSessionMap` | hook-state-manager | Claude UUID → managed session ID (in-memory) |
| `_sessionLocationMap` | Frontend | Claude UUID → `{groupId, slotIdx}` |
| 4-tier `_findSession()` fallback | hook-state-manager | Cache → resumeSessionId → running preference → CWD match |

There are also 4 parallel UUID detection paths (PTY 8s polling, hook-based immediate, SSE broadcast, WebSocket message), each updating different parts of the system independently.

The result is a class of bugs where these caches fall out of sync — notifications routed to the wrong terminal, "go to session" focusing the wrong pane, CWD-based matching creating false positives when multiple terminals share a working directory.

---

## Core Principle

Collapse all 6 maps/caches into **one session object** with embedded identity fields, plus **one reverse index** maintained by the Store. Every lookup goes through the Store. No component maintains its own identity cache.

---

## New Session Object Shape

```js
{
  id: 'local_<uuid>',            // stable, assigned at creation, NEVER changes
  claudeUUID: null | string,     // current Claude UUID, nullable, updated on detection and /clear
  previousClaudeUUIDs: string[], // UUIDs from before /clear events, newest first, capped at 50
  displayName: string,           // was in sessionNames map (and session.name)
  nameSource: 'auto' | 'manual', // was in sessionNameSources map
  workspaceId: string,
  workingDir: string,
  topic: string,
  command: string,
  tags: string[],
  status: 'stopped' | 'running' | 'error' | 'idle',
  pid: number | null,
  hookState: null | 'active' | 'awaiting_input' | 'idle' | 'stopped' | 'error',
  createdAt: string,
  lastActive: string,
  logs: Array<{time: string, message: string}>,
}
```

Key changes from the current shape:
- `resumeSessionId` renamed to `claudeUUID`
- `name` renamed to `displayName` (current field is `session.name` — this rename touches ~50 call sites across server.js and app.js; see Migration section for approach)
- `nameSource` moved from separate `sessionNameSources` map onto the session object
- `id` is the stable local identifier and is the primary navigation key throughout the system

---

## Store Changes

### New Reverse Index

`claudeUUIDIndex` — a `Map<claudeUUID, sessionId>` maintained internally by the Store class. Built on load from persisted session data. Never written to disk directly — it is always derived from session objects.

This is the **only** place the Claude UUID → session mapping lives in the backend.

### New Method: `store.setClaudeUUID(sessionId, newUUID)`

- Looks up the session by `sessionId`
- If the session had a previous `claudeUUID`, removes the old index entry
- Sets `session.claudeUUID = newUUID`
- Adds the new index entry: `claudeUUIDIndex.set(newUUID, sessionId)`
- Emits `session:uuid-changed` event with `{ sessionId, oldUUID, newUUID }`
- Saves immediately (this is a critical state change)

The index swap is atomic from the caller's perspective — there is no window where both the old and new UUIDs point to the session, or where neither does.

### New Method: `store.getSessionByClaudeUUID(claudeUUID)`

```js
store.getSessionByClaudeUUID(claudeUUID)
  → claudeUUIDIndex.get(claudeUUID)     // O(1) lookup
  → sessions[sessionId]                 // session object or null
```

Single lookup, no fallback chain.

### Eliminated from Store State

| Removed | Replaced By |
|---|---|
| `sessionNames` map | `session.displayName` field |
| `sessionNameSources` map | `session.nameSource` field |
| `setSessionName()` | Direct field access via `store.updateSession()` |
| `getSessionName()` | `session.displayName` |
| `getAllSessionNames()` | Iterate sessions, read `displayName` |
| `getSessionNameSource()` | `session.nameSource` |
| `getAllSessionNameSources()` | Iterate sessions, read `nameSource` |

---

## What Gets Eliminated

| Old Structure | Replaced By |
|---|---|
| `sessionNames[claudeUUID]` (store) | `session.displayName` field |
| `sessionNameSources[claudeUUID]` (store) | `session.nameSource` field |
| `_liveSessionMap` (hook-state-manager) | `store.getSessionByClaudeUUID()` |
| `_sessionLocationMap` (frontend) | Pane lookup by stable `session.id` |
| 4-tier `_findSession()` fallback | Single `store.getSessionByClaudeUUID()` call |
| CWD-based session matching | Gone entirely |

---

## UUID Lifecycle

```
1. Terminal created
     session.id = 'local_<uuid>'
     claudeUUID = null

2. First message sent → UUID detected
     store.setClaudeUUID(sessionId, uuid1)
     claudeUUIDIndex: { uuid1 → sessionId }

3. /clear invoked → new UUID detected
     store.setClaudeUUID(sessionId, uuid2)
     claudeUUIDIndex: { uuid2 → sessionId }   ← uuid1 removed atomically

4. Session always findable by session.id
   regardless of claudeUUID state
```

### Behavior on `/clear`

When `/clear` creates a new conversation and a new UUID is detected:
- `session.claudeUUID` is updated to the new UUID
- `session.displayName` is **reset to the new UUID** and `nameSource` set to `'auto'` — the old title described the old conversation and no longer applies
- Cost tracking starts fresh (new JSONL file)
- The old UUID's JSONL file remains on disk but is not linked to the session
- If the user had manually named the session, the manual name is preserved (only auto-names are reset)

---

## Detection Path Consolidation

All 4 current detection paths funnel into one call: `store.setClaudeUUID(sessionId, detectedUUID)`.

### PTY Manager (`pty-manager.js`)

- 8s initial detection and 30s polling both call `store.setClaudeUUID(sessionId, detectedUUID)`
- Still sends `uuid-detected` WebSocket message to the frontend for UI refresh
- No longer calls `store.setSessionName()` or `store.updateSession(id, { resumeSessionId })` as separate steps

### Hook State Manager (`hook-state-manager.js`)

- `_findSession()` becomes a one-liner:
  ```js
  return store.getSessionByClaudeUUID(claudeUUID);
  ```
- `_liveSessionMap` eliminated entirely
- On `session-start`, if the UUID isn't indexed yet (race with PTY detection), call `store.setClaudeUUID()` as a fallback — safe because `setClaudeUUID()` is idempotent when called with the same UUID twice
- No more CWD-based matching

### Frontend (`app.js`)

- On `uuid-detected` WebSocket message: refresh the pane's display — the pane already knows its `session.id`, so no identity remapping is needed
- On `session:hook-state` SSE: no need to stamp `claudeSessionId` on panes or maintain `_sessionLocationMap`
- Notification "go to session" logic: receives `sessionId` (stable local ID) → find pane where `pane.sessionId === sessionId` → focus it

### SSE Events

- `session:notification` payload: include `sessionId` (stable local ID) as the primary navigation key
- `claudeSessionId` may still appear for informational/debugging purposes but is **not** used for pane lookup

---

## Notification → Terminal Flow (After Change)

```
Hook arrives (Claude UUID)
  → store.getSessionByClaudeUUID(uuid)
    → session object (with stable session.id)
      → SSE broadcast with session.id
        → frontend: find pane where pane.sessionId === session.id
          → focus
```

Three hops. Zero ambiguity. No fallback chains.

Current flow has up to 7 hops with 4 fallback branches — any one of which can resolve to the wrong terminal.

---

## Frontend Pane Identity

Each terminal pane holds `sessionId` (the stable local ID). This never changes for the lifetime of the pane.

The pane does **not** need to know the Claude UUID — that is the Store's responsibility.

When rendering session names, titles, or any identity-derived UI, the frontend reads `session.displayName` from the session object returned by the API. It does not maintain a local `sessionNames` map.

---

## API Changes

### Eliminated Endpoints

| Endpoint | Reason |
|---|---|
| `GET /api/session-names` | Replaced by `displayName` field on session objects |
| `PUT /api/session-names/:claudeId` | Replaced by `PUT /api/sessions/:id` |

### Modified Endpoints

| Endpoint | Change |
|---|---|
| `POST /api/sessions` | Accepts `displayName` and `nameSource` fields directly |
| `PUT /api/sessions/:id` | Accepts `displayName`, `nameSource` updates |
| `GET /api/sessions` / `GET /api/sessions/:id` | Returns `displayName`, `nameSource`, `claudeUUID` as fields |
| `POST /api/sessions/:id/auto-title` | Sets `session.displayName` and `session.nameSource = 'auto'` directly on the session object |

### New Endpoints

None. UUID detection is internal — `store.setClaudeUUID()` is called by the detection paths, not by external API consumers.

---

## Discovery Integration

When discovering sessions from `~/.claude/projects/`:

- `ensureSessionRegistered()` creates a session with `claudeUUID` set immediately (known from the JSONL filename)
- `store.setClaudeUUID()` is called at creation time — no separate registration step
- `displayName` is set from the conversation preview, or falls back to the UUID
- No separate `sessionNames` registration needed

---

## Cost Tracking and Message Context

Features that read JSONL files (cost tracking, message history) are keyed by Claude UUID. After this change:

- They look up `session.claudeUUID` to find the current conversation file
- After `/clear`, the old JSONL file is no longer associated — cost tracking starts fresh for the new UUID
- Historical cost data for old UUIDs remains accessible on disk via JSONL files, but is not linked to the managed session object

### Previous UUIDs

The session object includes a `previousClaudeUUIDs` array:

```js
previousClaudeUUIDs: string[]  // UUIDs from before /clear events, newest first
```

When `setClaudeUUID()` replaces an old UUID, the old one is pushed to this array. This enables:
- Aggregate cost views across a session's full history (sum costs across all UUIDs)
- "Session history" UI showing past conversations
- Debugging (trace which JSONL files belonged to this terminal)

The array is append-only and capped at 50 entries to prevent unbounded growth.

---

## Migration Strategy

The migration is phased to keep the system functional throughout. Each phase is a separate commit so any phase can be reverted independently.

### Rollback Safety

Old fields (`resumeSessionId`, `name`, `sessionNames`, `sessionNameSources`) are **preserved as read-only** in the state file through Phases 1–3. They are not deleted until Phase 4. This means if a bug is discovered in Phase 2 or 3, the code can be reverted and old fields are still intact.

### Phase 1 — Store Migration

**Field additions:**
- Add `claudeUUID` field to session objects (copied from `resumeSessionId`)
- Add `displayName` field (copied from `name`)
- Add `nameSource` field (default `'auto'`)
- Add `previousClaudeUUIDs: []` field
- Build `claudeUUIDIndex` on load from session `claudeUUID` fields

**SessionNames migration:**
- For each entry in old `sessionNames[uuid]`:
  - First, try to find a session where `claudeUUID === uuid` (direct match)
  - If no match, scan `previousClaudeUUIDs` arrays (handles sessions that were `/clear`ed before migration)
  - If still no match, the name is orphaned — log a warning but do not discard; keep the old map until Phase 4
- For matched sessions, set `displayName` from `sessionNames` and `nameSource` from `sessionNameSources`
- **Do not delete** old `sessionNames`/`sessionNameSources` maps yet — they are the rollback safety net

**`name` → `displayName` rename strategy:**
- In Phase 1, the store populates BOTH `name` and `displayName` on every session (kept in sync)
- All existing code continues reading `session.name` — no breakage
- New code can start reading `session.displayName`
- The store's `createSession()` and `updateSession()` methods sync both fields transparently

**Deprecated store methods:** Keep `setSessionName()`, `getSessionName()`, etc. alive, delegating to new fields. Mark with `// DEPRECATED: remove in Phase 4` comments.

### Phase 2 — Backend Consolidation

- Update `hook-state-manager.js`: replace `_findSession()` with `store.getSessionByClaudeUUID()`, remove `_liveSessionMap`
- Update `pty-manager.js`: consolidate detection paths to call `store.setClaudeUUID()`
- Update server endpoints: add new fields to session response, keep old endpoints working (deprecated)
- Update SSE payloads: include `sessionId` as primary key in `session:notification`
- **Rename call sites:** Systematically replace `session.name` reads/writes with `session.displayName` across server.js (~25 sites) and pty-manager.js (~5 sites)

### Phase 3 — Frontend Consolidation

- Remove `_sessionLocationMap`
- Update notification handlers to navigate by `sessionId`
- Remove `sessionNames`/`sessionNameSources` from frontend state
- **Rename call sites:** Replace `session.name` with `session.displayName` across app.js (~25 sites)
- Update `uuid-detected` handler — no identity remapping needed, only UI refresh
- Remove deprecated API endpoint calls (`GET /api/session-names`, etc.)

### Phase 4 — Cleanup (after one release cycle of stability)

- Remove deprecated store methods
- Remove old `sessionNames`/`sessionNameSources` maps from state file
- Remove `session.name` field (only `displayName` remains)
- Remove `session.resumeSessionId` field (only `claudeUUID` remains)
- Remove deprecated API endpoints
- Remove migration/sync code from store

---

## Edge Cases

**Session with no Claude UUID yet**
Hooks don't arrive until Claude is active in that terminal. Notifications for pre-conversation terminals won't fire. This is correct behavior — there's nothing to route to.

**Multiple terminals with the same CWD**
Each has its own `session.id` and its own `claudeUUID`. No ambiguity. CWD-based matching is eliminated entirely.

**Server restart**
`claudeUUIDIndex` is rebuilt from persisted session data on load. No data loss. The index is always derivable from the session objects.

**Orphaned UUIDs after `/clear`**
Old UUID index entries are removed atomically by `setClaudeUUID()`. Old JSONL files remain on disk for historical access but are not linked to any active session.

**Race between PTY detection and hook**
Both call `setClaudeUUID()` with the same UUID. The second call detects that `session.claudeUUID` already equals `newUUID` and is a no-op. Safe.

**`setClaudeUUID()` called with same UUID twice**
No-op. Index entry already exists and points to the correct session. No event emitted, no save triggered.

---

## Testing Plan

### Unit Tests

- `store.setClaudeUUID()`:
  - Verify index entry is created on first set
  - Verify old index entry is removed when UUID changes
  - Verify `session:uuid-changed` event is emitted with correct `{ sessionId, oldUUID, newUUID }`
  - Verify no-op behavior when called with the same UUID
  - Verify save is triggered on change but not on no-op

- `store.getSessionByClaudeUUID()`:
  - Verify correct session returned for indexed UUID
  - Verify `null` returned for unknown UUID
  - Verify `null` returned after UUID is replaced by a new one

### Integration Tests

- Create session → detect UUID → verify `session.claudeUUID` set and index updated
- `/clear` → verify old UUID removed from index, new UUID indexed, session still findable by `session.id`
- Hook arrives → notification → verify correct terminal receives focus (end-to-end)
- Multiple terminals, one receives hook → verify only that terminal is focused

### Migration Tests

- Load old-format state file with `sessionNames`/`sessionNameSources` maps → verify fields migrated to session objects correctly
- Load old-format state file with `resumeSessionId` → verify renamed to `claudeUUID`
- Load state after migration → verify `claudeUUIDIndex` is built correctly
- Load state where a `sessionNames` entry has a UUID that doesn't match any session's current `resumeSessionId` (orphaned by prior `/clear`) → verify warning is logged and old map is preserved
- Verify rollback: revert to Phase 1 code after Phase 2 changes → old `name`, `resumeSessionId`, `sessionNames` fields still intact and functional

### Regression Tests

- Notifications are not routed to wrong terminals after UUID change
- "Go to session" focuses the correct pane after multiple `/clear` cycles
- Session names persist across server restarts
- Auto-named sessions don't revert to UUID display after restart
