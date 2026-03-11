#!/usr/bin/env node
/**
 * Unit tests for Store migration logic — Phase 1 of Unified Session Identity refactor.
 *
 * Tests:
 *   1. resumeSessionId → claudeUUID migration
 *   2. sessionNames/sessionNameSources → displayName/nameSource migration
 *   3. claudeUUIDIndex built correctly on load
 *   4. displayName defaults to session.name when no sessionNames entry
 *   5. Orphaned sessionNames entry preserved in old map
 */

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'state', 'workspaces.json');
const STATE_DIR  = path.join(__dirname, '..', 'state');

let pass = 0, fail = 0;
function check(label, ok, detail) {
  if (ok) {
    console.log('  PASS  ' + label);
    pass++;
  } else {
    console.log('  FAIL  ' + label + (detail ? ' — ' + detail : ''));
    fail++;
  }
}

/**
 * Run fn(store) with a fresh store pre-loaded from the given stateData.
 * Clears require cache before and after to ensure isolation.
 */
function withFreshStore(stateData, fn) {
  // Ensure state dir exists
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });

  // Write state file
  fs.writeFileSync(STATE_FILE, JSON.stringify(stateData, null, 2), 'utf-8');

  // Clear require cache for store module
  const storePath = require.resolve('../src/state/store');
  const docsPath  = require.resolve('../src/state/docs-manager');
  delete require.cache[storePath];
  delete require.cache[docsPath];

  let store;
  try {
    const { getStore } = require('../src/state/store');
    store = getStore();
    fn(store);
  } finally {
    if (store) store.destroy();
    // Clear require cache again so next call starts fresh
    delete require.cache[storePath];
    delete require.cache[docsPath];
  }
}

// ─── Shared fixture helpers ──────────────────────────────────────────────────

function makeBaseState(overrides = {}) {
  return {
    version: 1,
    workspaces: {
      ws1: { id: 'ws1', name: 'Test WS', sessions: ['sess1'], createdAt: '2026-01-01T00:00:00.000Z', lastActive: '2026-01-01T00:00:00.000Z', color: 'cyan', description: '' },
    },
    sessions: {},
    activeWorkspace: 'ws1',
    recentSessions: [],
    workspaceGroups: {},
    workspaceOrder: [],
    templates: {},
    features: {},
    worktreeTasks: {},
    projectDefaults: {},
    sessionNames: {},
    sessionNameSources: {},
    settings: {},
    ...overrides,
  };
}

function makeOldSession(overrides = {}) {
  return {
    id: 'sess1',
    name: 'My Session',
    workspaceId: 'ws1',
    workingDir: '/home/user',
    topic: '',
    command: 'claude',
    resumeSessionId: 'claude-uuid-1',
    status: 'stopped',
    pid: null,
    tags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    lastActive: '2026-01-01T00:00:00.000Z',
    logs: [],
    hookState: null,
    ...overrides,
  };
}

// ─── Test 1: resumeSessionId → claudeUUID migration ─────────────────────────

console.log('\nTest 1: resumeSessionId → claudeUUID migration');
withFreshStore(
  makeBaseState({
    sessions: { sess1: makeOldSession({ resumeSessionId: 'claude-uuid-1' }) },
  }),
  (store) => {
    const session = store.getSession('sess1');
    check('session has claudeUUID set from resumeSessionId',
      session && session.claudeUUID === 'claude-uuid-1');
    check('session still has resumeSessionId for backward compat',
      session && session.resumeSessionId === 'claude-uuid-1');
    check('session has previousClaudeUUIDs array',
      session && Array.isArray(session.previousClaudeUUIDs) && session.previousClaudeUUIDs.length === 0);
    check('session has nameSource defaulted to auto',
      session && session.nameSource === 'auto');
  }
);

// ─── Test 2: sessionNames/sessionNameSources → displayName/nameSource migration ──

console.log('\nTest 2: sessionNames/sessionNameSources → displayName/nameSource migration');
withFreshStore(
  makeBaseState({
    sessions: { sess1: makeOldSession({ resumeSessionId: 'claude-uuid-1' }) },
    sessionNames: { 'claude-uuid-1': 'Migrated Display Name' },
    sessionNameSources: { 'claude-uuid-1': 'manual' },
  }),
  (store) => {
    const session = store.getSession('sess1');
    check('displayName migrated from sessionNames',
      session && session.displayName === 'Migrated Display Name',
      session ? `got "${session.displayName}"` : 'session not found');
    check('nameSource migrated from sessionNameSources',
      session && session.nameSource === 'manual',
      session ? `got "${session.nameSource}"` : 'session not found');
  }
);

// ─── Test 3: claudeUUIDIndex built correctly on load ────────────────────────

console.log('\nTest 3: claudeUUIDIndex built correctly on load');
withFreshStore(
  makeBaseState({
    sessions: { sess1: makeOldSession({ resumeSessionId: 'claude-uuid-1' }) },
  }),
  (store) => {
    const found = store.getSessionByClaudeUUID('claude-uuid-1');
    check('getSessionByClaudeUUID returns session for indexed UUID',
      found && found.id === 'sess1',
      found ? `got id "${found.id}"` : 'returned null');
    check('getSessionByClaudeUUID returns null for unknown UUID',
      store.getSessionByClaudeUUID('no-such-uuid') === null);
  }
);

// ─── Test 4: displayName defaults to session.name when no sessionNames entry ─

console.log('\nTest 4: displayName defaults to session.name when no sessionNames entry');
withFreshStore(
  makeBaseState({
    sessions: { sess1: makeOldSession({ name: 'My Session', resumeSessionId: 'claude-uuid-1' }) },
    sessionNames: {}, // No entry for claude-uuid-1
  }),
  (store) => {
    const session = store.getSession('sess1');
    check('displayName defaults to session.name',
      session && session.displayName === 'My Session',
      session ? `got "${session.displayName}"` : 'session not found');
    check('nameSource defaults to auto',
      session && session.nameSource === 'auto',
      session ? `got "${session.nameSource}"` : 'session not found');
  }
);

// ─── Test 5: Orphaned sessionNames entry preserved in old map ────────────────

console.log('\nTest 5: Orphaned sessionNames entry preserved in old map');
withFreshStore(
  makeBaseState({
    sessions: { sess1: makeOldSession({ resumeSessionId: 'claude-uuid-current' }) },
    sessionNames: {
      'claude-uuid-current': 'Current Session Name',
      'claude-uuid-orphaned': 'Orphaned Session Name', // No session has this UUID
    },
    sessionNameSources: {
      'claude-uuid-current': 'auto',
      'claude-uuid-orphaned': 'manual',
    },
  }),
  (store) => {
    const allNames = store.getAllSessionNames();
    check('orphaned sessionNames entry preserved in old map',
      allNames && allNames['claude-uuid-orphaned'] === 'Orphaned Session Name',
      allNames ? `got "${allNames['claude-uuid-orphaned']}"` : 'getAllSessionNames returned null');
    check('current session entry also preserved in old map',
      allNames && allNames['claude-uuid-current'] === 'Current Session Name');
    // The current session should have its displayName migrated
    const session = store.getSession('sess1');
    check('current session displayName migrated from sessionNames',
      session && session.displayName === 'Current Session Name',
      session ? `got "${session.displayName}"` : 'session not found');
  }
);

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
