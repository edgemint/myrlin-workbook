/**
 * Hook State Manager
 *
 * Listens for Claude Code hook events (emitted by the hooks router),
 * computes session state transitions, updates the store, and triggers
 * notifications via SSE broadcast.
 *
 * State machine:
 *   SessionStart / PreToolUse / PostToolUse / UserPromptSubmit → active
 *   Stop / PermissionRequest → awaiting_input
 *   No activity for N min after awaiting_input → idle
 *   SessionEnd → stopped
 *   3+ PostToolUseFailure in 60s → error
 */

'use strict';

const { getStore } = require('../state/store');

// Hook event slugs that indicate Claude is actively working (thinking/executing)
const ACTIVE_EVENTS = new Set([
  'pre-tool-use',
  'post-tool-use',
  'user-prompt-submit',
  'subagent-start',
  'pre-compact',
]);

// Hook event slugs that indicate Claude is waiting for user
const AWAITING_EVENTS = new Set([
  'stop',
  'permission-request',
]);

// How many failures in the window trigger error state
const ERROR_FAILURE_THRESHOLD = 3;
const ERROR_WINDOW_MS = 60_000;

class HookStateManager {
  /**
   * @param {object} opts
   * @param {import('events').EventEmitter} opts.hookBus — the EventEmitter that hooks-router emits on
   * @param {function} opts.broadcastSSE — the server's broadcastSSE function
   */
  constructor({ hookBus, broadcastSSE }) {
    this._hookBus = hookBus;
    this._broadcastSSE = broadcastSSE;
    this._idleTimers = new Map();       // claudeSessionId → timeoutId
    this._failureWindows = new Map();   // claudeSessionId → [timestamp, ...]

    this._hookBus.on('hook', (event) => this._handleHookEvent(event));
  }

  _handleHookEvent({ slug, payload }) {
    const claudeSessionId = payload.session_id;
    if (!claudeSessionId) return;

    const cwd = payload.cwd || null;

    // Find the matching managed session
    const session = this._findSession(claudeSessionId);

    // On session-start, register UUID if not yet indexed (race with PTY detection)
    if (slug === 'session-start' && claudeSessionId) {
      const store = getStore();
      const existing = store.getSessionByClaudeUUID(claudeSessionId);
      if (!existing && session) {
        store.setClaudeUUID(session.id, claudeSessionId);
      }
    }

    if (slug === 'session-end') {
      this._transition(session, claudeSessionId, 'stopped', slug, payload);
      this._clearIdleTimer(claudeSessionId);
      this._failureWindows.delete(claudeSessionId);
      return;
    }

    if (slug === 'post-tool-use-failure') {
      this._recordFailure(claudeSessionId);
      // Notify on individual tool failures if enabled
      this._maybeNotifyToolFailure(session, claudeSessionId, payload);
      if (this._isErrorThresholdMet(claudeSessionId)) {
        this._transition(session, claudeSessionId, 'error', slug, payload);
      }
      return;
    }

    // Successful tool use resets the failure counter
    if (slug === 'post-tool-use') {
      this._failureWindows.delete(claudeSessionId);
    }

    if (ACTIVE_EVENTS.has(slug)) {
      this._clearIdleTimer(claudeSessionId);
      this._transition(session, claudeSessionId, 'active', slug, payload);
      return;
    }

    if (AWAITING_EVENTS.has(slug)) {
      this._transition(session, claudeSessionId, 'awaiting_input', slug, payload);
      this._startIdleTimer(claudeSessionId);
      return;
    }

    // For other events (config-change, worktree-*, teammate-idle, task-completed, etc.)
    // broadcast but don't transition state
    if (session) {
      this._broadcastSSE('session:hook-event', {
        sessionId: session.id,
        claudeSessionId,
        slug,
        payload: { tool_name: payload.tool_name, message: payload.message },
      });
    }

    // Handle task-completed notification even without state transition
    if (slug === 'task-completed') {
      this._maybeNotifyTaskCompleted(session, claudeSessionId, payload);
    }
  }

  /**
   * Find the managed session for a Claude session ID.
   * Single index lookup — no fallback chain.
   * @param {string} claudeSessionId
   * @returns {object|null}
   */
  _findSession(claudeSessionId) {
    if (!claudeSessionId) return null;
    return getStore().getSessionByClaudeUUID(claudeSessionId);
  }

  _transition(session, claudeSessionId, newState, slug, payload) {
    if (!session) {
      // No managed session matched — just broadcast the raw event
      this._broadcastSSE('session:hook-state', {
        sessionId: null,
        claudeSessionId,
        hookState: newState,
        trigger: slug,
      });
      return;
    }

    const oldState = session.hookState;
    if (oldState === newState) return; // No change

    // Update the store
    const store = getStore();
    store.updateSession(session.id, { hookState: newState });

    // Broadcast state change via SSE
    this._broadcastSSE('session:hook-state', {
      sessionId: session.id,
      claudeSessionId,
      hookState: newState,
      previousState: oldState,
      trigger: slug,
      toolName: payload.tool_name || null,
      message: payload.message || payload.last_assistant_message || null,
    });

    // Check notification triggers
    this._maybeNotify(session, claudeSessionId, newState, slug, payload);
  }

  _maybeNotify(session, claudeSessionId, newState, slug, payload) {
    const store = getStore();
    const notifSettings = store.settings.hookNotifications;
    if (!notifSettings || !notifSettings.enabled) return;

    const triggers = notifSettings.triggers || {};
    let shouldNotify = false;
    let notifType = null;
    let notifMessage = null;

    if (newState === 'awaiting_input' && slug === 'stop' && triggers.awaiting_input) {
      shouldNotify = true;
      notifType = 'awaiting_input';
      notifMessage = 'Waiting for your input';
    } else if (newState === 'awaiting_input' && slug === 'permission-request' && triggers.permission_needed) {
      shouldNotify = true;
      notifType = 'permission_needed';
      notifMessage = `Needs permission for ${payload.tool_name || 'a tool'}`;
    } else if (newState === 'error' && triggers.session_error) {
      shouldNotify = true;
      notifType = 'session_error';
      notifMessage = 'Repeated tool failures detected';
    } else if (newState === 'idle' && triggers.idle) {
      shouldNotify = true;
      notifType = 'idle';
      notifMessage = 'Session went idle';
    }

    if (shouldNotify) {
      this._emitNotification(session, claudeSessionId, notifType, notifMessage);
    }
  }

  _maybeNotifyToolFailure(session, claudeSessionId, payload) {
    const store = getStore();
    const notifSettings = store.settings.hookNotifications;
    if (!notifSettings || !notifSettings.enabled) return;
    if (!(notifSettings.triggers || {}).tool_failure) return;

    this._emitNotification(
      session,
      claudeSessionId,
      'tool_failure',
      `Tool failed: ${payload.tool_name || 'unknown'}${payload.error ? ' — ' + payload.error.slice(0, 100) : ''}`
    );
  }

  _maybeNotifyTaskCompleted(session, claudeSessionId, payload) {
    const store = getStore();
    const notifSettings = store.settings.hookNotifications;
    if (!notifSettings || !notifSettings.enabled) return;
    if (!(notifSettings.triggers || {}).task_completed) return;

    this._emitNotification(
      session,
      claudeSessionId,
      'task_completed',
      `Task completed${payload.task_subject ? ': ' + payload.task_subject : ''}`
    );
  }

  _emitNotification(session, claudeSessionId, notifType, notifMessage) {
    this._broadcastSSE('session:notification', {
      sessionId: session ? session.id : null,
      claudeSessionId,
      type: notifType,
      sessionName: session ? (session.displayName || session.name || session.id) : claudeSessionId,
      workspaceName: session ? this._getWorkspaceName(session.workspaceId) : null,
      message: notifMessage,
    });
  }

  _getWorkspaceName(workspaceId) {
    if (!workspaceId) return null;
    const store = getStore();
    const ws = store.workspaces[workspaceId];
    return ws ? ws.name : null;
  }

  // ─── Idle Timer ─────────────────────────────────────────────

  _startIdleTimer(claudeSessionId) {
    this._clearIdleTimer(claudeSessionId);
    const store = getStore();
    const timeoutMin = (store.settings.hookNotifications || {}).idleTimeoutMinutes || 5;

    const timer = setTimeout(() => {
      this._idleTimers.delete(claudeSessionId);
      const session = this._findSession(claudeSessionId);
      if (session && session.hookState === 'awaiting_input') {
        this._transition(session, claudeSessionId, 'idle', 'idle-timeout', {});
      }
    }, timeoutMin * 60_000);

    timer.unref();
    this._idleTimers.set(claudeSessionId, timer);
  }

  _clearIdleTimer(claudeSessionId) {
    const timer = this._idleTimers.get(claudeSessionId);
    if (timer) {
      clearTimeout(timer);
      this._idleTimers.delete(claudeSessionId);
    }
  }

  // ─── Error Detection ───────────────────────────────────────

  _recordFailure(claudeSessionId) {
    const now = Date.now();
    let failures = this._failureWindows.get(claudeSessionId) || [];
    failures.push(now);
    failures = failures.filter(t => now - t < ERROR_WINDOW_MS);
    this._failureWindows.set(claudeSessionId, failures);
  }

  _isErrorThresholdMet(claudeSessionId) {
    const failures = this._failureWindows.get(claudeSessionId) || [];
    return failures.length >= ERROR_FAILURE_THRESHOLD;
  }

  // ─── Cleanup ────────────────────────────────────────────────

  destroy() {
    for (const timer of this._idleTimers.values()) clearTimeout(timer);
    this._idleTimers.clear();
    this._failureWindows.clear();
  }
}

module.exports = { HookStateManager };
