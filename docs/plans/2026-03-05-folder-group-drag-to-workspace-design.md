# Design: Drag Folder Groups Between Workspaces

**Date:** 2026-03-05
**Status:** Approved

## Problem

In the workspace session list, sessions are grouped by their `workingDir` into collapsible folder groups (`ws-project-group`). There is no way to move an entire folder group from one workspace to another — you'd have to drag each session individually.

## Solution

Make `.ws-project-group-header` elements draggable. Dropping one onto a workspace item moves all sessions in that directory group to the target workspace via the existing `moveSessionToWorkspace` path. No files on disk are touched; only `workspaceId` changes in app state and the server store.

## Architecture

### Data flow

1. User grabs a `.ws-project-group-header`
2. `dragstart` emits `cwm/project-group` = `{ dir, wsId }` (JSON)
3. User drags over a `.workspace-item` — it highlights as a drop target
4. User drops — handler finds all sessions where `session.workspaceId === wsId && session.workingDir === dir`, calls `moveSessionToWorkspace(id, targetWsId)` for each
5. UI re-renders; toast confirms "Moved N sessions to 'WorkspaceName'"

### Affected code (all in `src/web/public/app.js`)

| Location | Change |
|---|---|
| `renderWorkspaceList` (~line 7798) | Add `draggable="true"` to `.ws-project-group-header` |
| `dragstart` listener (~line 1547) | Add branch: if `.ws-project-group-header`, set `cwm/project-group` |
| `dragend` listener (~line 1566) | Extend selector to also clear `.ws-project-group` dragging class |
| `dragover` listener (~line 1573) | Accept `cwm/project-group` on `.workspace-item`, add highlight class |
| `dragleave` listener (~line 1606) | Already clears `.workspace-item` highlight — no change needed |
| `drop` listener (~line 1614) | Add `cwm/project-group` branch before workspace-reorder handling |

### New method: `moveFolderGroupToWorkspace(dir, srcWsId, targetWsId)`

```
- Find all sessions: workspaceId === srcWsId && workingDir === dir
- Skip if srcWsId === targetWsId or no sessions found
- For each session: call moveSessionToWorkspace(session.id, targetWsId)
- Show single consolidated toast: "Moved N sessions to '<workspace>'"
```

Reuses `moveSessionToWorkspace` so API calls, state updates, and re-renders are handled consistently.

## Visual feedback

- Dragging: `.ws-project-group` gets `.dragging` opacity reduction (reuse existing `.dragging` CSS)
- Drop target: `.workspace-item` gets `.workspace-drop-target` highlight (already styled)

## Edge cases

- Drop on same workspace: no-op (silent)
- No matching sessions found: no-op (shouldn't happen, but safe to guard)
- Partial API failure: each session is moved independently; failures surface via existing error toast per session

## Out of scope

- Context-menu alternative (can be added later)
- Dragging folder groups in the Claude Projects panel (different panel, different design needed)
