# Stubs and Deferred Cleanup

## Phase 4 Cleanup — Unified Session Identity

**Files:**
- `src/state/store.js`: Methods `setSessionName()`, `getSessionName()`, `getAllSessionNames()`, `getSessionNameSource()`, `getAllSessionNameSources()` — currently delegate to `session.displayName`/`session.nameSource`. Remove after one stable release cycle.
- `src/state/store.js`: Fields `session.name` and `session.resumeSessionId` — currently synced from `displayName`/`claudeUUID`. Drop when no callers remain.
- `src/state/store.js`: State maps `sessionNames`, `sessionNameSources` — preserved for rollback safety. Remove from `_migrateState()` and DEFAULT_STATE.
- `src/web/server.js`: Endpoints `GET /api/session-names`, `PUT /api/session-names/:claudeId` — deprecated, return data from session objects. Remove after frontend confirmed migrated.
- `src/web/pty-manager.js` line ~461: `store.setSessionName()` call for sessions with no managed session ID — needs Phase 4 migration to handle unmanaged panes differently.
- `src/web/pty-server.js`: Query param `resumeSessionId` — rename to `claudeUUID` in both terminal.js sender and pty-server.js receiver.
- `src/web/public/app.js`: `syncSessionTitle()` falls back to legacy `/api/session-names/:uuid` for unregistered discovered sessions — remove fallback in Phase 4.

**Dependencies:** Confirm no external consumers of deprecated API endpoints before removal.
