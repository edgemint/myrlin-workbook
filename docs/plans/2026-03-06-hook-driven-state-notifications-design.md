# Hook-Driven Session State & Notifications Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Use Claude Code hook events to drive real-time session state transitions and configurable browser notifications.

**Architecture:** Event bus pattern — hooks router emits events, a dedicated HookStateManager module handles state machine logic, store updates, and notification triggers. Frontend receives state changes via SSE.

**Tech Stack:** Node.js EventEmitter, Express, existing store/SSE infrastructure

---

## Session States

5 states derived from hook events:

| State | Triggered by | Meaning |
|---|---|---|
| `active` | SessionStart, PreToolUse, PostToolUse, UserPromptSubmit | Claude is working |
| `awaiting_input` | Stop, PermissionRequest | Needs user attention |
| `idle` | 5 min timeout after awaiting_input with no activity | Nobody's engaging |
| `stopped` | SessionEnd | Session terminated |
| `error` | 3+ PostToolUseFailure in 60s | Repeated failures |

## State Machine Transitions

```
SessionStart / PreToolUse / PostToolUse / UserPromptSubmit → active
Stop / PermissionRequest → awaiting_input
No activity for 5 min after awaiting_input → idle
SessionEnd → stopped
3+ PostToolUseFailure in 60s → error
Any activity event clears idle timer and error counter
```

## Session Matching

Hook payloads carry `session_id` (Claude UUID) + `cwd`.

1. **Managed sessions**: Match `hook.session_id === session.resumeSessionId`
2. **Unmanaged sessions**: If no managed match, auto-create a discovered session entry using `session_id` + `cwd` from the hook payload

## Data Flow

```
Claude Code
  → hook-relay.js (stdin → POST, exits 0 on failure)
  → POST /hooks/:event
  → hooks-router.js (logs to console, emits on EventEmitter)
  → HookStateManager
      → matches session_id to store session
      → computes state transition
      → store.updateSession(id, { hookState })
      → broadcastSSE('session:hook-state', { sessionId, hookState, event, ... })
      → if notification trigger enabled → push to notification queue
  → Frontend receives SSE
      → updates session card UI (state badge)
      → shows browser notification (if enabled in global settings)
```

## Notification System

### Global Settings

Stored in the existing settings system (accessible via `/api/settings`):

```json
{
  "notifications": {
    "enabled": true,
    "triggers": {
      "awaiting_input": true,
      "permission_needed": true,
      "task_completed": true,
      "tool_failure": false,
      "session_error": false,
      "idle": false
    },
    "idleTimeoutMinutes": 5
  }
}
```

### Default Triggers (on)

- **awaiting_input** — Stop event: "Session X is waiting for your input"
- **permission_needed** — PermissionRequest event: "Session X needs permission for [tool]"
- **task_completed** — TaskCompleted event: "Task completed in session X"

### Default Triggers (off)

- **tool_failure** — PostToolUseFailure
- **session_error** — error state transition
- **idle** — idle state transition

### Browser Notification Format

- Title: session name + workspace name
- Body: what happened
- Click action: focus that session's terminal tab (via existing tab switching)

## Idle Timer

- HookStateManager maintains `Map<sessionId, timeoutId>` for idle detection
- On Stop/PermissionRequest: start 5-min timer
- On any activity event (UserPromptSubmit, PreToolUse, PostToolUse, SessionStart): clear timer
- On timer expiry: transition to `idle`
- On SessionEnd: clear timer, transition to `stopped`

## Files to Create/Modify

| File | Change |
|---|---|
| `src/core/hook-state-manager.js` | **New** — EventEmitter listener, state machine, timers, notification triggers |
| `src/web/hooks-router.js` | **Modify** — emit events on shared bus in addition to logging |
| `src/web/server.js` | **Modify** — initialize HookStateManager, wire to store + SSE broadcast |
| `src/web/public/app.js` | **Modify** — handle `session:hook-state` SSE events, render state badges, browser notifications |
| `src/state/store.js` | **Modify** — add `hookState` field to session objects |
| Settings endpoint | **Modify** — add notification settings to GET/POST `/api/settings` |

## Error State Logic

Track PostToolUseFailure events per session in a sliding window:
- Keep timestamps of last N failures per session
- If 3+ failures within 60 seconds → transition to `error`
- Any successful PostToolUse resets the failure counter
- Error state is not terminal — next activity event transitions back to `active`
