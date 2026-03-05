/**
 * Workspace Manager - High-level workspace operations
 * Wraps store methods with business logic for creating, switching,
 * deleting workspaces, and managing their sessions.
 */

const { getStore } = require('../state/store');
const { stopSession } = require('./session-manager');

/**
 * Create a new workspace with the given name and options.
 * @param {string} name - Workspace name
 * @param {{ description?: string, color?: string }} [opts={}] - Optional settings
 * @returns {object} The created workspace
 */
function createWorkspace(name, opts = {}) {
  const store = getStore();

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('Workspace name is required');
  }

  const workspace = store.createWorkspace({
    name: name.trim(),
    description: opts.description || '',
    color: opts.color || 'cyan',
  });

  store.addSessionLog && undefined; // noop - workspaces don't have logs
  return workspace;
}

/**
 * Switch to a different workspace by ID.
 * @param {string} id - Workspace ID to activate
 * @returns {boolean} True if switch succeeded
 */
function switchWorkspace(id) {
  const store = getStore();
  const workspace = store.getWorkspace(id);

  if (!workspace) {
    throw new Error(`Workspace ${id} not found`);
  }

  return store.setActiveWorkspace(id);
}

/**
 * Delete a workspace. Stops all running sessions in it first.
 * @param {string} id - Workspace ID to delete
 * @returns {boolean} True if deletion succeeded
 */
function deleteWorkspace(id) {
  const store = getStore();
  const workspace = store.getWorkspace(id);

  if (!workspace) {
    throw new Error(`Workspace ${id} not found`);
  }

  // Stop all sessions in this workspace before deleting
  const sessions = store.getWorkspaceSessions(id);
  for (const session of sessions) {
    if (session.status === 'running') {
      stopSession(session.id);
    }
  }

  return store.deleteWorkspace(id);
}

/**
 * Add a new session to a workspace.
 * @param {string} workspaceId - Target workspace ID
 * @param {{ name: string, workingDir?: string, topic?: string, command?: string }} sessionOpts - Session options
 * @returns {object|null} The created session, or null if workspace doesn't exist
 */
function addSessionToWorkspace(workspaceId, sessionOpts) {
  const store = getStore();
  const workspace = store.getWorkspace(workspaceId);

  if (!workspace) {
    throw new Error(`Workspace ${workspaceId} not found`);
  }

  return store.createSession({
    name: (sessionOpts && sessionOpts.name) || '',
    workspaceId,
    workingDir: sessionOpts.workingDir || '',
    topic: sessionOpts.topic || '',
    command: sessionOpts.command || 'claude',
  });
}

/**
 * Get statistics for a workspace's sessions.
 * @param {string} id - Workspace ID
 * @returns {{ total: number, running: number, stopped: number, errors: number }}
 */
function getWorkspaceStats(id) {
  const store = getStore();
  const workspace = store.getWorkspace(id);

  if (!workspace) {
    throw new Error(`Workspace ${id} not found`);
  }

  const sessions = store.getWorkspaceSessions(id);

  const stats = {
    total: sessions.length,
    running: 0,
    stopped: 0,
    errors: 0,
  };

  for (const session of sessions) {
    switch (session.status) {
      case 'running':
        stats.running++;
        break;
      case 'error':
        stats.errors++;
        break;
      case 'stopped':
      case 'idle':
      default:
        stats.stopped++;
        break;
    }
  }

  return stats;
}

module.exports = {
  createWorkspace,
  switchWorkspace,
  deleteWorkspace,
  addSessionToWorkspace,
  getWorkspaceStats,
};
