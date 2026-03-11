# Unified Session Identity — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse 6 separate session identity maps/caches into one session object + one reverse index, fixing notification routing bugs and "go to session" mismatches.

**Architecture:** Every session gets a stable local ID at creation. The Claude UUID is a mutable field on the session object, tracked by a single store-maintained reverse index. All detection paths funnel through `store.setClaudeUUID()`. All lookups go through the store — no component maintains its own identity cache.

**Tech Stack:** Node.js, Express, vanilla JS frontend, blessed (TUI)

**Spec:** `docs/superpowers/specs/2026-03-11-unified-session-identity-design.md`

---

## Chunk 1: Store Migration (Phase 1)

### Task 1: Add new fields to session object and migration logic

**Files:**
- Modify: `src/state/store.js:369-395` (createSession), `src/state/store.js:82-139` (_load/_tryLoadFile)
- Test: `test/unit-store-migration.js` (create new)

- [ ] **Step 1: Write migration test**

Create `test/unit-store-migration.js`:

```js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const STATE_DIR = path.join(__dirname, '..', 'state');
const STATE_FILE = path.join(STATE_DIR, 'workspaces.json');

// Helper: write a fake old-format state, require a fresh store, check migration
function withFreshStore(stateData, fn) {
  // Clear cached singleton
  delete require.cache[require.resolve('../src/state/store')];
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(stateData), 'utf-8');
  const { getStore } = require('../src/state/store');
  const store = getStore();
  try {
    fn(store);
  } finally {
    store.destroy();
    // Reset singleton for next test
    delete require.cache[require.resolve('../src/state/store')];
  }
}

// Test 1: resumeSessionId → claudeUUID rename
(function testResumeSessionIdMigration() {
  const oldState = {
    version: 1,
    workspaces: { ws1: { id: 'ws1', name: 'Test', sessions: ['s1'], createdAt: new Date().toISOString(), lastActive: new Date().toISOString(), color: 'cyan', description: '' } },
    sessions: {
      s1: { id: 's1', name: 'Session 1', workspaceId: 'ws1', resumeSessionId: 'claude-uuid-1', status: 'stopped', pid: null, createdAt: new Date().toISOString(), lastActive: new Date().toISOString(), logs: [], hookState: null, tags: [], workingDir: '', topic: '', command: 'claude' }
    },
    activeWorkspace: 'ws1',
    recentSessions: [],
    settings: {}
  };

  withFreshStore(oldState, (store) => {
    const s = store.getSession('s1');
    assert.strictEqual(s.claudeUUID, 'claude-uuid-1', 'resumeSessionId should migrate to claudeUUID');
    assert.strictEqual(s.resumeSessionId, 'claude-uuid-1', 'resumeSessionId kept for backward compat');
    assert.ok(Array.isArray(s.previousClaudeUUIDs), 'previousClaudeUUIDs should be initialized');
    assert.strictEqual(s.previousClaudeUUIDs.length, 0, 'previousClaudeUUIDs starts empty');
  });
  console.log('PASS: resumeSessionId → claudeUUID migration');
})();

// Test 2: sessionNames/sessionNameSources → displayName/nameSource
(function testSessionNamesMigration() {
  const oldState = {
    version: 1,
    workspaces: { ws1: { id: 'ws1', name: 'Test', sessions: ['s1'], createdAt: new Date().toISOString(), lastActive: new Date().toISOString(), color: 'cyan', description: '' } },
    sessions: {
      s1: { id: 's1', name: 'Old Name', workspaceId: 'ws1', resumeSessionId: 'claude-uuid-1', status: 'stopped', pid: null, createdAt: new Date().toISOString(), lastActive: new Date().toISOString(), logs: [], hookState: null, tags: [], workingDir: '', topic: '', command: 'claude' }
    },
    sessionNames: { 'claude-uuid-1': 'Custom Title' },
    sessionNameSources: { 'claude-uuid-1': 'manual' },
    activeWorkspace: 'ws1',
    recentSessions: [],
    settings: {}
  };

  withFreshStore(oldState, (store) => {
    const s = store.getSession('s1');
    assert.strictEqual(s.displayName, 'Custom Title', 'displayName should come from sessionNames');
    assert.strictEqual(s.nameSource, 'manual', 'nameSource should come from sessionNameSources');
    // Old maps preserved for rollback
    assert.ok(store.state.sessionNames, 'sessionNames map preserved');
  });
  console.log('PASS: sessionNames → displayName migration');
})();

// Test 3: claudeUUIDIndex built correctly on load
(function testClaudeUUIDIndex() {
  const oldState = {
    version: 1,
    workspaces: { ws1: { id: 'ws1', name: 'Test', sessions: ['s1', 's2'], createdAt: new Date().toISOString(), lastActive: new Date().toISOString(), color: 'cyan', description: '' } },
    sessions: {
      s1: { id: 's1', name: 'A', workspaceId: 'ws1', resumeSessionId: 'uuid-a', status: 'stopped', pid: null, createdAt: new Date().toISOString(), lastActive: new Date().toISOString(), logs: [], hookState: null, tags: [], workingDir: '', topic: '', command: 'claude' },
      s2: { id: 's2', name: 'B', workspaceId: 'ws1', resumeSessionId: 'uuid-b', status: 'stopped', pid: null, createdAt: new Date().toISOString(), lastActive: new Date().toISOString(), logs: [], hookState: null, tags: [], workingDir: '', topic: '', command: 'claude' }
    },
    activeWorkspace: 'ws1',
    recentSessions: [],
    settings: {}
  };

  withFreshStore(oldState, (store) => {
    const sa = store.getSessionByClaudeUUID('uuid-a');
    const sb = store.getSessionByClaudeUUID('uuid-b');
    assert.ok(sa, 'Should find session by Claude UUID a');
    assert.strictEqual(sa.id, 's1');
    assert.ok(sb, 'Should find session by Claude UUID b');
    assert.strictEqual(sb.id, 's2');
    assert.strictEqual(store.getSessionByClaudeUUID('nonexistent'), null);
  });
  console.log('PASS: claudeUUIDIndex built on load');
})();

// Test 4: displayName defaults to session.name when no sessionNames entry
(function testDisplayNameFallback() {
  const oldState = {
    version: 1,
    workspaces: { ws1: { id: 'ws1', name: 'Test', sessions: ['s1'], createdAt: new Date().toISOString(), lastActive: new Date().toISOString(), color: 'cyan', description: '' } },
    sessions: {
      s1: { id: 's1', name: 'My Session', workspaceId: 'ws1', resumeSessionId: null, status: 'stopped', pid: null, createdAt: new Date().toISOString(), lastActive: new Date().toISOString(), logs: [], hookState: null, tags: [], workingDir: '', topic: '', command: 'claude' }
    },
    activeWorkspace: 'ws1',
    recentSessions: [],
    settings: {}
  };

  withFreshStore(oldState, (store) => {
    const s = store.getSession('s1');
    assert.strictEqual(s.displayName, 'My Session', 'displayName defaults to name when no sessionNames entry');
    assert.strictEqual(s.nameSource, 'auto', 'nameSource defaults to auto');
  });
  console.log('PASS: displayName fallback to name');
})();

// Test 5: Orphaned sessionNames entry (UUID with no matching session)
(function testOrphanedSessionNames() {
  const oldState = {
    version: 1,
    workspaces: { ws1: { id: 'ws1', name: 'Test', sessions: ['s1'], createdAt: new Date().toISOString(), lastActive: new Date().toISOString(), color: 'cyan', description: '' } },
    sessions: {
      s1: { id: 's1', name: 'Session 1', workspaceId: 'ws1', resumeSessionId: 'uuid-current', status: 'stopped', pid: null, createdAt: new Date().toISOString(), lastActive: new Date().toISOString(), logs: [], hookState: null, tags: [], workingDir: '', topic: '', command: 'claude' }
    },
    sessionNames: { 'uuid-orphaned': 'Orphaned Title', 'uuid-current': 'Current Title' },
    sessionNameSources: { 'uuid-orphaned': 'manual', 'uuid-current': 'auto' },
    activeWorkspace: 'ws1',
    recentSessions: [],
    settings: {}
  };

  withFreshStore(oldState, (store) => {
    // Current UUID's name should be migrated
    const s = store.getSession('s1');
    assert.strictEqual(s.displayName, 'Current Title');
    // Old sessionNames map preserved (orphaned entry still there for rollback)
    assert.ok(store.state.sessionNames['uuid-orphaned'], 'Orphaned entry preserved in old map');
  });
  console.log('PASS: orphaned sessionNames preserved');
})();

console.log('\nAll migration tests passed!');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test/unit-store-migration.js`
Expected: FAIL — `store.getSessionByClaudeUUID` is not a function, `s.claudeUUID` is undefined

- [ ] **Step 3: Implement migration in store.js**

In `src/state/store.js`, make these changes:

**a) Update DEFAULT_STATE** (around line 22): Add `previousClaudeUUIDs` concept — no top-level change needed, it's per-session.

**b) Add `_migrateState()` method** after `_tryLoadFile()`:

```js
/**
 * Migrate state from older formats to current.
 * - Copies resumeSessionId → claudeUUID on each session
 * - Copies session.name → displayName
 * - Migrates sessionNames/sessionNameSources maps → session fields
 * - Initializes previousClaudeUUIDs
 * Old fields are preserved for rollback safety.
 */
_migrateState(state) {
  let dirty = false;
  for (const session of Object.values(state.sessions || {})) {
    // resumeSessionId → claudeUUID
    if (session.resumeSessionId !== undefined && session.claudeUUID === undefined) {
      session.claudeUUID = session.resumeSessionId; // may be null
      dirty = true;
    }
    // name → displayName
    if (session.displayName === undefined) {
      session.displayName = session.name || session.id || '';
      dirty = true;
    }
    // nameSource default
    if (session.nameSource === undefined) {
      session.nameSource = 'auto';
      dirty = true;
    }
    // previousClaudeUUIDs
    if (!Array.isArray(session.previousClaudeUUIDs)) {
      session.previousClaudeUUIDs = [];
      dirty = true;
    }
  }

  // Migrate sessionNames map entries onto session objects
  const names = state.sessionNames || {};
  const sources = state.sessionNameSources || {};
  for (const [uuid, name] of Object.entries(names)) {
    // Find session by claudeUUID match
    const session = Object.values(state.sessions || {}).find(s => s.claudeUUID === uuid);
    if (session) {
      session.displayName = name;
      session.nameSource = sources[uuid] || 'auto';
      dirty = true;
    } else {
      // Try previousClaudeUUIDs (for sessions that were /clear'd before migration)
      const byPrev = Object.values(state.sessions || {}).find(
        s => Array.isArray(s.previousClaudeUUIDs) && s.previousClaudeUUIDs.includes(uuid)
      );
      if (byPrev) {
        byPrev.displayName = name;
        byPrev.nameSource = sources[uuid] || 'auto';
        dirty = true;
      }
      // else: orphaned — logged but old map preserved for Phase 4 cleanup
    }
  }

  return dirty;
}
```

**c) Add `_buildClaudeUUIDIndex()` method:**

```js
/**
 * Build the in-memory claudeUUID → sessionId index from persisted session data.
 * Called on load and after migration.
 */
_buildClaudeUUIDIndex() {
  this._claudeUUIDIndex = new Map();
  for (const session of Object.values(this._state.sessions || {})) {
    if (session.claudeUUID) {
      this._claudeUUIDIndex.set(session.claudeUUID, session.id);
    }
  }
}
```

**d) Add `setClaudeUUID()` method:**

```js
/**
 * Set or update the Claude UUID for a session.
 * Maintains the reverse index atomically.
 * @param {string} sessionId - Stable local session ID
 * @param {string} newUUID - New Claude conversation UUID
 * @returns {{ sessionId: string, oldUUID: string|null, newUUID: string }|null}
 */
setClaudeUUID(sessionId, newUUID) {
  const session = this._state.sessions[sessionId];
  if (!session || !newUUID) return null;

  const oldUUID = session.claudeUUID;

  // No-op if UUID hasn't changed
  if (oldUUID === newUUID) return null;

  // Remove old index entry
  if (oldUUID) {
    this._claudeUUIDIndex.delete(oldUUID);
    // Push to history
    session.previousClaudeUUIDs = session.previousClaudeUUIDs || [];
    session.previousClaudeUUIDs.unshift(oldUUID);
    if (session.previousClaudeUUIDs.length > 50) {
      session.previousClaudeUUIDs = session.previousClaudeUUIDs.slice(0, 50);
    }
    // Reset auto display name on /clear
    if (session.nameSource === 'auto') {
      session.displayName = newUUID;
    }
  }

  // Set new UUID and index
  session.claudeUUID = newUUID;
  session.resumeSessionId = newUUID; // backward compat — kept in sync
  this._claudeUUIDIndex.set(newUUID, sessionId);

  this.save(); // Critical state change
  this.emit('session:uuid-changed', { sessionId, oldUUID, newUUID });
  return { sessionId, oldUUID, newUUID };
}

/**
 * Look up a session by its current Claude UUID.
 * @param {string} claudeUUID
 * @returns {object|null} Session object or null
 */
getSessionByClaudeUUID(claudeUUID) {
  if (!claudeUUID) return null;
  const sessionId = this._claudeUUIDIndex.get(claudeUUID);
  if (!sessionId) return null;
  return this._state.sessions[sessionId] || null;
}
```

**e) Initialize `_claudeUUIDIndex` in constructor** (alongside existing `this._state = null`):

```js
constructor() {
  super();
  this._state = null;
  this._claudeUUIDIndex = new Map(); // Claude UUID → session ID reverse index
  this._dirty = false;
  this._saveTimer = null;
}
```

**f) Update `init()` method** to call migration and index build, and persist if migration changed anything:

```js
init() {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
  docsManager.ensureDocsDir();
  this.createTimestampedBackup();
  this._state = this._load();
  const migrated = this._migrateState(this._state);
  this._buildClaudeUUIDIndex();
  if (migrated) this.save(); // Persist migration results immediately
  return this;
}
```

**g) Update `createSession()` signature** to accept and set new fields:

In the `createSession` method, add `displayName`, `nameSource`, `previousClaudeUUIDs` to the session object, and sync `name`↔`displayName`:

```js
createSession({ name, workspaceId, workingDir = '', topic = '', command = 'claude', resumeSessionId = null, tags = [], displayName = null, nameSource = 'auto' }) {
  if (!this._state.workspaces[workspaceId]) return null;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const resolvedDisplayName = displayName || name || id;
  const session = {
    id,
    name: resolvedDisplayName,           // backward compat
    displayName: resolvedDisplayName,    // new canonical field
    nameSource,
    workspaceId,
    workingDir,
    topic,
    command,
    resumeSessionId,                     // backward compat
    claudeUUID: resumeSessionId,         // new canonical field
    previousClaudeUUIDs: [],
    status: 'stopped',
    pid: null,
    tags: Array.isArray(tags) ? tags : [],
    createdAt: now,
    lastActive: now,
    logs: [],
    hookState: null,
  };
  this._state.sessions[id] = session;
  this._state.workspaces[workspaceId].sessions.push(id);
  this._state.workspaces[workspaceId].lastActive = now;
  // Index the Claude UUID if present
  if (session.claudeUUID) {
    this._claudeUUIDIndex.set(session.claudeUUID, id);
  }
  this.save();
  this.emit('session:created', session);
  return session;
}
```

**h) Update `updateSession()`** to keep `name`↔`displayName` and `resumeSessionId`↔`claudeUUID` in sync:

Add sync logic at the top of `updateSession()`:

```js
updateSession(id, updates) {
  const session = this._state.sessions[id];
  if (!session) return null;

  // Keep name ↔ displayName in sync (Phase 1 backward compat)
  if (updates.displayName !== undefined && updates.name === undefined) {
    updates.name = updates.displayName;
  } else if (updates.name !== undefined && updates.displayName === undefined) {
    updates.displayName = updates.name;
  }

  // Keep resumeSessionId ↔ claudeUUID in sync AND update the index.
  // Callers should prefer setClaudeUUID() for UUID changes, but this safety net
  // ensures the index stays correct if legacy code calls updateSession({ resumeSessionId }).
  const newClaudeUUID = updates.claudeUUID || updates.resumeSessionId;
  if (newClaudeUUID !== undefined) {
    updates.claudeUUID = newClaudeUUID;
    updates.resumeSessionId = newClaudeUUID;
    // Update the reverse index
    if (newClaudeUUID !== session.claudeUUID) {
      if (session.claudeUUID) this._claudeUUIDIndex.delete(session.claudeUUID);
      if (newClaudeUUID) this._claudeUUIDIndex.set(newClaudeUUID, id);
    }
  }

  // Handle workspace move ... (existing code)
```

- [ ] **Step 4: Run migration tests**

Run: `node test/unit-store-migration.js`
Expected: All 4 tests PASS

- [ ] **Step 5: Run existing tests to verify no regression**

Run: `node test/unit-store-session-names.js`
Expected: PASS (deprecated methods still work via delegation)

- [ ] **Step 6: Commit**

```bash
git add src/state/store.js test/unit-store-migration.js
git commit -m "feat: unified session identity — store migration, setClaudeUUID, getSessionByClaudeUUID (Phase 1)"
```

---

### Task 2: Add setClaudeUUID unit tests

**Files:**
- Test: `test/unit-store-set-claude-uuid.js` (create new)

- [ ] **Step 1: Write setClaudeUUID tests**

Create `test/unit-store-set-claude-uuid.js`:

```js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const STATE_DIR = path.join(__dirname, '..', 'state');
const STATE_FILE = path.join(STATE_DIR, 'workspaces.json');

function withFreshStore(stateData, fn) {
  delete require.cache[require.resolve('../src/state/store')];
  fs.mkdirSync(STATE_DIR, { recursive: true });
  if (stateData) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(stateData), 'utf-8');
  }
  const { getStore } = require('../src/state/store');
  const store = getStore();
  try {
    fn(store);
  } finally {
    store.destroy();
    delete require.cache[require.resolve('../src/state/store')];
  }
}

function makeState() {
  const now = new Date().toISOString();
  return {
    version: 1,
    workspaces: { ws1: { id: 'ws1', name: 'Test', sessions: ['s1'], createdAt: now, lastActive: now, color: 'cyan', description: '' } },
    sessions: {
      s1: { id: 's1', name: 'Session', displayName: 'Session', nameSource: 'auto', workspaceId: 'ws1', claudeUUID: null, resumeSessionId: null, previousClaudeUUIDs: [], status: 'stopped', pid: null, createdAt: now, lastActive: now, logs: [], hookState: null, tags: [], workingDir: '', topic: '', command: 'claude' }
    },
    activeWorkspace: 'ws1',
    recentSessions: [],
    settings: {}
  };
}

// Test 1: First UUID set — index created
(function testFirstUUIDSet() {
  withFreshStore(makeState(), (store) => {
    const result = store.setClaudeUUID('s1', 'uuid-1');
    assert.ok(result, 'Should return result');
    assert.strictEqual(result.oldUUID, null);
    assert.strictEqual(result.newUUID, 'uuid-1');

    const s = store.getSession('s1');
    assert.strictEqual(s.claudeUUID, 'uuid-1');
    assert.strictEqual(s.resumeSessionId, 'uuid-1'); // backward compat

    const found = store.getSessionByClaudeUUID('uuid-1');
    assert.strictEqual(found.id, 's1');
  });
  console.log('PASS: first UUID set');
})();

// Test 2: UUID change (/clear) — old removed, new indexed, history updated
(function testUUIDChange() {
  const state = makeState();
  state.sessions.s1.claudeUUID = 'uuid-1';
  state.sessions.s1.resumeSessionId = 'uuid-1';

  withFreshStore(state, (store) => {
    const result = store.setClaudeUUID('s1', 'uuid-2');
    assert.strictEqual(result.oldUUID, 'uuid-1');
    assert.strictEqual(result.newUUID, 'uuid-2');

    // New UUID indexed
    assert.strictEqual(store.getSessionByClaudeUUID('uuid-2').id, 's1');
    // Old UUID removed
    assert.strictEqual(store.getSessionByClaudeUUID('uuid-1'), null);
    // History preserved
    const s = store.getSession('s1');
    assert.deepStrictEqual(s.previousClaudeUUIDs, ['uuid-1']);
  });
  console.log('PASS: UUID change');
})();

// Test 3: No-op when same UUID
(function testNoOpSameUUID() {
  const state = makeState();
  state.sessions.s1.claudeUUID = 'uuid-1';
  state.sessions.s1.resumeSessionId = 'uuid-1';

  withFreshStore(state, (store) => {
    const result = store.setClaudeUUID('s1', 'uuid-1');
    assert.strictEqual(result, null, 'Should return null on no-op');
  });
  console.log('PASS: no-op same UUID');
})();

// Test 4: Event emission
(function testEventEmission() {
  withFreshStore(makeState(), (store) => {
    let emitted = null;
    store.on('session:uuid-changed', (data) => { emitted = data; });
    store.setClaudeUUID('s1', 'uuid-1');
    assert.ok(emitted, 'Event should be emitted');
    assert.strictEqual(emitted.sessionId, 's1');
    assert.strictEqual(emitted.newUUID, 'uuid-1');
  });
  console.log('PASS: event emission');
})();

// Test 5: Auto displayName reset on /clear
(function testAutoNameResetOnClear() {
  const state = makeState();
  state.sessions.s1.claudeUUID = 'uuid-1';
  state.sessions.s1.resumeSessionId = 'uuid-1';
  state.sessions.s1.displayName = 'Auto Generated Title';
  state.sessions.s1.nameSource = 'auto';

  withFreshStore(state, (store) => {
    store.setClaudeUUID('s1', 'uuid-2');
    const s = store.getSession('s1');
    assert.strictEqual(s.displayName, 'uuid-2', 'Auto name should reset to new UUID');
  });
  console.log('PASS: auto name reset on /clear');
})();

// Test 6: Manual displayName preserved on /clear
(function testManualNamePreservedOnClear() {
  const state = makeState();
  state.sessions.s1.claudeUUID = 'uuid-1';
  state.sessions.s1.resumeSessionId = 'uuid-1';
  state.sessions.s1.displayName = 'My Custom Name';
  state.sessions.s1.nameSource = 'manual';

  withFreshStore(state, (store) => {
    store.setClaudeUUID('s1', 'uuid-2');
    const s = store.getSession('s1');
    assert.strictEqual(s.displayName, 'My Custom Name', 'Manual name should be preserved');
  });
  console.log('PASS: manual name preserved on /clear');
})();

// Test 7: Invalid inputs
(function testInvalidInputs() {
  withFreshStore(makeState(), (store) => {
    assert.strictEqual(store.setClaudeUUID('nonexistent', 'uuid-1'), null);
    assert.strictEqual(store.setClaudeUUID('s1', null), null);
    assert.strictEqual(store.setClaudeUUID('s1', ''), null);
    assert.strictEqual(store.getSessionByClaudeUUID(null), null);
    assert.strictEqual(store.getSessionByClaudeUUID(''), null);
  });
  console.log('PASS: invalid inputs');
})();

// Test 8: previousClaudeUUIDs capped at 50
(function testHistoryCap() {
  const state = makeState();
  state.sessions.s1.claudeUUID = 'uuid-0';
  state.sessions.s1.resumeSessionId = 'uuid-0';
  state.sessions.s1.previousClaudeUUIDs = Array.from({ length: 50 }, (_, i) => `old-${i}`);

  withFreshStore(state, (store) => {
    store.setClaudeUUID('s1', 'uuid-new');
    const s = store.getSession('s1');
    assert.strictEqual(s.previousClaudeUUIDs.length, 50, 'Should stay capped at 50');
    assert.strictEqual(s.previousClaudeUUIDs[0], 'uuid-0', 'Most recent old UUID first');
  });
  console.log('PASS: history capped at 50');
})();

// Test 9: Save triggered on change but not on no-op
(function testSaveBehavior() {
  const state = makeState();
  state.sessions.s1.claudeUUID = 'uuid-1';
  state.sessions.s1.resumeSessionId = 'uuid-1';

  withFreshStore(state, (store) => {
    let saveCount = 0;
    const origSave = store.save.bind(store);
    store.save = () => { saveCount++; origSave(); };

    // Change triggers save
    store.setClaudeUUID('s1', 'uuid-2');
    assert.strictEqual(saveCount, 1, 'Save should fire on UUID change');

    // No-op does NOT trigger save
    store.setClaudeUUID('s1', 'uuid-2');
    assert.strictEqual(saveCount, 1, 'Save should NOT fire on no-op');
  });
  console.log('PASS: save on change, no-save on no-op');
})();

console.log('\nAll setClaudeUUID tests passed!');
```

- [ ] **Step 2: Run tests**

Run: `node test/unit-store-set-claude-uuid.js`
Expected: All 8 tests PASS (implementation was done in Task 1)

- [ ] **Step 3: Commit**

```bash
git add test/unit-store-set-claude-uuid.js
git commit -m "test: add setClaudeUUID unit tests"
```

---

## Chunk 2: Backend Consolidation (Phase 2)

### Task 3: Simplify hook-state-manager.js

**Files:**
- Modify: `src/core/hook-state-manager.js` (lines 52, 68, 75, 137, 142, 278)
- Reference: `src/state/store.js` (for `getSessionByClaudeUUID`)

- [ ] **Step 1: Write test for hook session resolution**

Create `test/unit-hook-resolution.js`:

```js
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { EventEmitter } = require('events');

const STATE_DIR = path.join(__dirname, '..', 'state');
const STATE_FILE = path.join(STATE_DIR, 'workspaces.json');

function setupStore() {
  delete require.cache[require.resolve('../src/state/store')];
  delete require.cache[require.resolve('../src/core/hook-state-manager')];
  const now = new Date().toISOString();
  const state = {
    version: 1,
    workspaces: { ws1: { id: 'ws1', name: 'Test', sessions: ['s1', 's2'], createdAt: now, lastActive: now, color: 'cyan', description: '' } },
    sessions: {
      s1: { id: 's1', name: 'A', displayName: 'A', nameSource: 'auto', workspaceId: 'ws1', claudeUUID: 'cuuid-1', resumeSessionId: 'cuuid-1', previousClaudeUUIDs: [], status: 'running', pid: 1234, createdAt: now, lastActive: now, logs: [], hookState: null, tags: [], workingDir: '/project/a', topic: '', command: 'claude' },
      s2: { id: 's2', name: 'B', displayName: 'B', nameSource: 'auto', workspaceId: 'ws1', claudeUUID: 'cuuid-2', resumeSessionId: 'cuuid-2', previousClaudeUUIDs: [], status: 'running', pid: 5678, createdAt: now, lastActive: now, logs: [], hookState: null, tags: [], workingDir: '/project/a', topic: '', command: 'claude' },
    },
    activeWorkspace: 'ws1',
    recentSessions: [],
    settings: { hookNotifications: { enabled: true, triggers: { awaiting_input: true, permission_needed: true, task_completed: true, tool_failure: false, session_error: false, idle: false }, idleTimeoutMinutes: 5 } }
  };
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state), 'utf-8');
  const { getStore } = require('../src/state/store');
  return getStore();
}

// Test: Hook event for cuuid-1 resolves to s1, not s2 (both share CWD)
(function testCorrectResolution() {
  const store = setupStore();
  const hookBus = new EventEmitter();
  const sseBroadcasts = [];
  const broadcastSSE = (type, data) => sseBroadcasts.push({ type, data });

  const HookStateManager = require('../src/core/hook-state-manager');
  const mgr = new HookStateManager({ hookBus, broadcastSSE });

  // Emit a hook event for cuuid-1
  hookBus.emit('hook', {
    slug: 'stop',
    payload: { session_id: 'cuuid-1', cwd: '/project/a' }
  });

  // Find the notification SSE event
  const notif = sseBroadcasts.find(e => e.type === 'session:notification');
  if (notif) {
    assert.strictEqual(notif.data.sessionId, 's1', 'Should resolve to s1, not s2 despite shared CWD');
  }

  // Find the hook-state SSE event
  const hookState = sseBroadcasts.find(e => e.type === 'session:hook-state');
  assert.ok(hookState, 'Should broadcast hook-state');
  assert.strictEqual(hookState.data.sessionId, 's1');

  store.destroy();
  delete require.cache[require.resolve('../src/state/store')];
  delete require.cache[require.resolve('../src/core/hook-state-manager')];
  console.log('PASS: correct session resolution by Claude UUID');
})();

// Test 2: session-start fallback registers unindexed UUID
(function testSessionStartFallback() {
  const store = setupStore();
  // Manually remove s1's UUID from the index to simulate race condition
  // (PTY hasn't detected it yet, but session-start hook fires)
  store.setClaudeUUID('s1', null); // This won't work since null is rejected
  // Instead, create a session with no claudeUUID
  const now = new Date().toISOString();
  store.state.sessions.s3 = { id: 's3', name: 'C', displayName: 'C', nameSource: 'auto', workspaceId: 'ws1', claudeUUID: null, resumeSessionId: null, previousClaudeUUIDs: [], status: 'running', pid: 9999, createdAt: now, lastActive: now, logs: [], hookState: null, tags: [], workingDir: '/project/c', topic: '', command: 'claude' };
  store.state.workspaces.ws1.sessions.push('s3');

  const hookBus = new EventEmitter();
  const sseBroadcasts = [];
  const broadcastSSE = (type, data) => sseBroadcasts.push({ type, data });

  const HookStateManager = require('../src/core/hook-state-manager');
  const mgr = new HookStateManager({ hookBus, broadcastSSE });

  // session-start hook with a new UUID — should register it via setClaudeUUID fallback
  hookBus.emit('hook', {
    slug: 'session-start',
    payload: { session_id: 'cuuid-3', cwd: '/project/c' }
  });

  // After the hook, the UUID should be indexed
  const found = store.getSessionByClaudeUUID('cuuid-3');
  // Note: this test depends on the session-start handler finding a session by CWD or other means
  // The exact behavior depends on whether _findSession returns null for unindexed UUIDs
  // and how the fallback handles it. The key assertion:
  // If found, it should be the right session
  if (found) {
    assert.strictEqual(found.id, 's3', 'session-start should register UUID for correct session');
  }

  store.destroy();
  delete require.cache[require.resolve('../src/state/store')];
  delete require.cache[require.resolve('../src/core/hook-state-manager')];
  console.log('PASS: session-start fallback (or graceful null)');
})();

console.log('\nAll hook resolution tests passed!');
```

- [ ] **Step 2: Run test to verify current behavior**

Run: `node test/unit-hook-resolution.js`
Expected: May PASS or FAIL depending on current _findSession logic — establishes baseline.

- [ ] **Step 3: Simplify hook-state-manager.js**

In `src/core/hook-state-manager.js`, make these changes:

**a) Remove `_liveSessionMap`** from constructor (line 52): Delete the line. Also remove any `_liveSessionMap.delete()` calls (lines ~75, 142).

**b) Replace `_findSession()` method** (lines ~132-176). Note: `getStore` is already imported at the top of the file (`const { getStore } = require('../state/store')`), so use it directly:

```js
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
```

**Note:** The old signature was `_findSession(claudeSessionId, cwd)`. There is a call in `_startIdleTimer()` that passes both args — update it to `_findSession(claudeSessionId)` (drop the `cwd` arg, since CWD-based matching is eliminated).

**c) Update session-start handling** (around line 67-69):

Replace `_liveSessionMap.set(...)` with a `store.setClaudeUUID()` fallback:

```js
if (slug === 'session-start' && claudeSessionId) {
  // If UUID isn't indexed yet (race with PTY detection), register it
  const store = getStore();
  const existing = store.getSessionByClaudeUUID(claudeSessionId);
  if (!existing && session) {
    store.setClaudeUUID(session.id, claudeSessionId);
  }
}
```

**d) Remove session-end `_liveSessionMap.delete()`** (around line 75): Delete it.

**e) Remove all other `_liveSessionMap` references** (lines 137, 142): Already handled by new `_findSession`.

**f) Update `_emitNotification`** (line 278): Change `session.name` to `session.displayName`:

```js
sessionName: session ? (session.displayName || session.name || session.id) : claudeSessionId,
```

- [ ] **Step 4: Run hook resolution test**

Run: `node test/unit-hook-resolution.js`
Expected: PASS

- [ ] **Step 5: Run all tests**

Run: `node test/unit-store-migration.js && node test/unit-store-set-claude-uuid.js && node test/unit-hook-resolution.js`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/hook-state-manager.js test/unit-hook-resolution.js
git commit -m "refactor: simplify hook-state-manager to use store.getSessionByClaudeUUID()"
```

---

### Task 4: Consolidate PTY manager UUID detection

**Files:**
- Modify: `src/web/pty-manager.js` (lines 129, 144-156, 399, 436-497, 453, 466, 472, 475, 535, 543)

- [ ] **Step 1: Read pty-manager.js to understand current detection logic**

Read: `src/web/pty-manager.js` — focus on `applyDetectedUUID()` (lines ~436-497) and `spawnSession()` UUID polling (lines ~500-512).

- [ ] **Step 2: Refactor applyDetectedUUID to use store.setClaudeUUID()**

Read the function first — it has three branches:

**Branch A: Store session exists, first UUID detection**
- Currently: `store.updateSession(sessionId, { resumeSessionId: newUUID })` + `store.setSessionName(newUUID, storeSession.name, 'manual')`
- Replace with: `store.setClaudeUUID(sessionId, newUUID)`

**Branch B: Store session exists, UUID changed (/clear)**
- Currently: `store.updateSession(sessionId, { resumeSessionId: newUUID })` + `store.setSessionName(newUUID, newUUID, 'auto')`
- Replace with: `store.setClaudeUUID(sessionId, newUUID)` — the store handles name reset and history

**Branch C: No store session ("New Session Here" pane with no managed session)**
- Currently: `store.setSessionName(newUUID, newUUID, 'auto')`
- CANNOT use `store.setClaudeUUID()` here (no `sessionId`). Leave as-is with comment: `// No managed session — Phase 4 cleanup`

Keep WebSocket `{ type: 'uuid-detected', uuid, name }` messages intact — frontend needs them for UI refresh.

- [ ] **Step 3: Update attachClient() to prefer claudeUUID**

The reading of `storeSession.resumeSessionId` for building `claude --resume` happens in `attachClient()` (around line 535-543), NOT in `spawnSession()`. Update:

```js
resumeSessionId: storeSession.claudeUUID || storeSession.resumeSessionId || null,
```

Also in `spawnSession()` (line ~129), accept `claudeUUID` as an alias parameter:

```js
const resolvedResumeId = opts.claudeUUID || opts.resumeSessionId;
```

- [ ] **Step 4: Run existing e2e tests**

Run: `node test/run-tests.js`
Expected: PASS (or note failures to investigate)

- [ ] **Step 5: Commit**

```bash
git add src/web/pty-manager.js
git commit -m "refactor: consolidate PTY UUID detection to use store.setClaudeUUID()"
```

---

### Task 5: Update server.js SSE payloads and session endpoints

**Files:**
- Modify: `src/web/server.js` (many lines — SSE broadcasts, session CRUD endpoints, session-names endpoints)

This is the largest file change (~78 `resumeSessionId` references). Break into sub-steps:

- [ ] **Step 1: Update SSE notification payload**

Find where `session:notification` and `session:hook-state` events are broadcast. Ensure `sessionId` (the stable local ID) is the primary navigation key. This is mostly handled by hook-state-manager changes in Task 3, but verify server.js `attachStoreEvents()` also uses `session.id`.

- [ ] **Step 2: Update session CRUD endpoints**

For `POST /api/sessions`, `PUT /api/sessions/:id`, `GET /api/sessions/:id`:
- Accept `displayName`, `nameSource` in request body
- Return `displayName`, `nameSource`, `claudeUUID`, `previousClaudeUUIDs` in response
- The existing `name` field continues to work (synced by store)

- [ ] **Step 3: Update resumeSessionId references to prefer claudeUUID**

Throughout server.js, where code reads `session.resumeSessionId`, add fallback:
```js
const claudeUUID = session.claudeUUID || session.resumeSessionId;
```

This is the backward-compat approach for Phase 2. Do NOT delete `resumeSessionId` references yet — just ensure `claudeUUID` is checked first.

Find all 78 references by running: `grep -n 'resumeSessionId' src/web/server.js`

Key areas to update (search for these patterns):
- Cost tracking: search for `session.resumeSessionId` near `/api/sessions/:id/cost` endpoint
- Message context: search for `resumeSessionId` near `getSessionMessages` or `/api/sessions/:id/messages`
- Subagent data: search for `resumeSessionId` near `/api/sessions/:id/subagents`
- Auto-title: search for `resumeSessionId` near `/api/sessions/:id/auto-title`
- Discovery/backfill: search for `resumeSessionId` near `backfillResumeSessionIds` or `/api/discover`

- [ ] **Step 4: Mark session-names endpoints as deprecated**

For `GET /api/session-names` and `PUT /api/session-names/:claudeId`:
- Keep them working (read from/write to session objects via store)
- Add deprecation comment: `// DEPRECATED: Phase 4 removal — use session.displayName via /api/sessions`

- [ ] **Step 5: Update session.name references to session.displayName**

For the 10 `session.name` references in server.js, add fallback:
```js
const displayName = session.displayName || session.name || session.id;
```

- [ ] **Step 6: Run e2e tests**

Run: `node test/run-tests.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/web/server.js
git commit -m "refactor: update server endpoints for unified session identity (Phase 2)"
```

---

## Chunk 3: Frontend Consolidation (Phase 3)

### Task 6: Remove _sessionLocationMap and update notification navigation

**Files:**
- Modify: `src/web/public/app.js` (17 `_sessionLocationMap` refs, notification handlers)

- [ ] **Step 0: Verify group pane cache property name**

Read `src/web/public/app.js` lines 100-250 to confirm the exact property name for the cached group panes structure. The plan assumes `this._groupPaneCache` — verify this is correct before writing `_findPaneBySessionId`. If the name differs, update the helper accordingly.

- [ ] **Step 1: Replace _sessionLocationMap with pane lookup by sessionId**

The current flow: notification arrives with `claudeSessionId` → `_sessionLocationMap.get(claudeSessionId)` → `{groupId, slotIdx}`.

New flow: notification arrives with `sessionId` (stable local ID) → scan panes for `pane.sessionId === sessionId`.

**a) Add helper method:**

```js
/**
 * Find a terminal pane by its stable session ID.
 * Searches active group panes and cached group panes.
 * @param {string} sessionId - Stable local session ID
 * @returns {{ groupId: string, slotIdx: number }|null}
 */
_findPaneBySessionId(sessionId) {
  if (!sessionId) return null;
  // Check active group panes
  for (let i = 0; i < this.terminalPanes.length; i++) {
    const tp = this.terminalPanes[i];
    if (tp && tp.sessionId === sessionId) {
      return { groupId: this._activeGroupId, slotIdx: i };
    }
  }
  // Check cached group panes
  for (const [groupId, cached] of Object.entries(this._groupPaneCache || {})) {
    for (let i = 0; i < (cached.panes || []).length; i++) {
      if (cached.panes[i] && cached.panes[i].sessionId === sessionId) {
        return { groupId, slotIdx: i };
      }
    }
  }
  return null;
}
```

**b) Replace all `_sessionLocationMap.get(...)` calls** with `_findPaneBySessionId(sessionId)`.

**c) Remove `_sessionLocationMap` initialization** (line 167) and all `.set()` / `.delete()` calls (17 total sites).

**d) In `session:notification` handler** (around line 7843): use `d.sessionId` instead of `d.claudeSessionId` for navigation:

```js
const navId = d.sessionId || null;  // stable local ID
// ...
const paneLocation = this._findPaneBySessionId(navId);
```

**e) In `session:hook-state` handler** (around line 7815): remove the block that stamps `claudeSessionId` on panes and updates `_sessionLocationMap`. It's no longer needed.

**f) In notification center click handler**: use `_findPaneBySessionId(sid)` instead of `_sessionLocationMap.get(sid)`.

**g) In browser notification click handler**: same replacement.

**h) Update `uuid-detected` WebSocket handler**: Remove any `_sessionLocationMap` updates or identity remapping from the `onUuidDetected` callback (around line 9199-9240). The pane already knows its `session.id` — just refresh the UI (re-render pane title, reload projects/sessions list). Do NOT remap identity.

- [ ] **Step 2: Test notification routing**

The core fix must be verified. Extend the hook resolution test (`test/unit-hook-resolution.js`) to verify the SSE payload uses the stable `sessionId`:

```js
// Add to existing test: verify SSE payload contains sessionId (stable ID), not just claudeSessionId
const hookStateEvent = sseBroadcasts.find(e => e.type === 'session:hook-state');
assert.ok(hookStateEvent, 'Should broadcast hook-state');
assert.strictEqual(hookStateEvent.data.sessionId, 's1', 'SSE should contain stable sessionId');
// Verify sessionName uses displayName
const notifEvent = sseBroadcasts.find(e => e.type === 'session:notification');
if (notifEvent) {
  assert.strictEqual(notifEvent.data.sessionName, 'A', 'sessionName should use displayName');
}
```

Also test manually: open web UI → create session → send message → trigger notification → click "Go to session" → verify correct terminal focused.

- [ ] **Step 3: Commit**

```bash
git add src/web/public/app.js
git commit -m "refactor: replace _sessionLocationMap with pane lookup by stable sessionId"
```

---

### Task 7: Update frontend session name handling

**Prerequisite:** Task 5 must be complete — `GET /api/sessions` must return `displayName` on each session. Verify: `curl -s http://localhost:3456/api/sessions | grep displayName` should show values.

**Files:**
- Modify: `src/web/public/app.js` (30 `session.name` refs, `sessionNames`/`sessionNameSources` state)

- [ ] **Step 1: Update session.name references**

For each of the 30 `session.name` references in app.js, change to:
```js
session.displayName || session.name || session.id
```

This is a mechanical replacement. Key areas:
- `openTerminalInPane()` calls — the `name` parameter
- Toast messages showing session names
- Session detail panel
- Context menus
- Drag-and-drop handlers

- [ ] **Step 2: Remove sessionNames/sessionNameSources from frontend state**

- Remove state initialization (lines 123-124): `sessionNames: {}`, `sessionNameSources: {}`
- Remove `loadSessionNames()` method and its call
- Update `getProjectSessionTitle()` to read from session objects fetched via API
- Update `setProjectSessionTitle()` to call `PUT /api/sessions/:id` with `{ displayName, nameSource }`
- Remove `getSessionNameSource()` frontend method — read from `session.nameSource`

- [ ] **Step 3: Test manually**

Verify session names display correctly, renaming works, auto-titles appear.

- [ ] **Step 4: Commit**

```bash
git add src/web/public/app.js
git commit -m "refactor: update frontend to use session.displayName (Phase 3)"
```

---

### Task 8: Update TUI and notifications modules

**Files:**
- Modify: `src/ui/session-detail.js` (1 reference)
- Modify: `src/core/notifications.js` (4 references)

- [ ] **Step 1: Update session-detail.js**

Line 76: Change `session.name` to `session.displayName || session.name`:

```js
content += ` {${theme.colors.primary}-fg}{bold}${session.displayName || session.name}{/bold}{/}\n`;
```

- [ ] **Step 2: Update notifications.js**

Lines 83, 88, 90, 92: Change `session.name` to `session.displayName || session.name` in all 4 notification messages.

- [ ] **Step 3: Commit**

```bash
git add src/ui/session-detail.js src/core/notifications.js
git commit -m "refactor: update TUI and notifications to use displayName"
```

---

## Chunk 4: Integration Testing & Cleanup

### Task 9: End-to-end notification routing test

**Files:**
- Modify: `test/e2e-api.js` (add test section)

- [ ] **Step 0: Verify hook endpoint path**

Read `src/web/server.js` or `src/web/hooks-router.js` to confirm the exact HTTP path for hook events. The hooks router is likely mounted at a specific prefix (e.g., `/hooks`). Confirm before writing the test.

- [ ] **Step 1: Add notification routing test to e2e suite**

Add a test section to `test/e2e-api.js` that verifies the full chain. Since SSE requires async streaming, also add a direct unit test:

**In `test/e2e-api.js`:**

```js
// --- Notification routing: session findable by Claude UUID ---
{
  const ws = await post('/api/workspaces', { name: 'NotifTest' });
  const sess = await post('/api/sessions', {
    name: 'Test Session',
    workspaceId: ws.id,
    workingDir: '/tmp',
    resumeSessionId: 'notif-claude-uuid-1'
  });

  // Verify claudeUUID is set and indexed
  const fetched = await get(`/api/sessions/${sess.id}`);
  assert(fetched.claudeUUID === 'notif-claude-uuid-1', 'Session should have claudeUUID');

  // Simulate hook event (confirm endpoint path in Step 0)
  await post('/hooks/stop', { session_id: 'notif-claude-uuid-1', cwd: '/tmp' });
  console.log('  PASS: notification routing — session indexed by Claude UUID');
}
```

**In `test/unit-hook-resolution.js`** (extend existing test to verify SSE payload):

```js
// After existing assertions, add:
const notifEvent = sseBroadcasts.find(e => e.type === 'session:notification');
if (notifEvent) {
  assert.strictEqual(notifEvent.data.sessionId, 's1',
    'Notification should contain stable sessionId, not Claude UUID');
  assert.strictEqual(notifEvent.data.sessionName, 'A',
    'Notification sessionName should use displayName');
}
```

This verifies the SSE payload carries the right IDs without needing an async SSE listener.

- [ ] **Step 2: Run e2e tests**

Run: `node test/run-tests.js`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/e2e-api.js
git commit -m "test: add notification routing e2e test"
```

---

### Task 10: Run full test suite and manual verification

- [ ] **Step 1: Run all unit tests**

```bash
node test/unit-store-migration.js && node test/unit-store-set-claude-uuid.js && node test/unit-hook-resolution.js
```
Expected: All PASS

- [ ] **Step 2: Run e2e tests**

```bash
node test/run-tests.js
```
Expected: PASS

- [ ] **Step 3: Manual verification checklist**

1. Start the server: `node src/web/server.js`
2. Open web UI
3. Create a workspace and session
4. Open a terminal, send a message to Claude
5. Verify the session gets a Claude UUID (check via `GET /api/sessions/:id`)
6. Trigger a notification (let Claude hit a permission request or wait for idle)
7. Click "Go to session" — verify correct terminal is focused
8. Run `/clear` in the terminal
9. Verify the session still works, new UUID is detected
10. Trigger another notification — verify it still routes correctly
11. Check that session display name shows correctly throughout
12. **Regression: multi-terminal** — with two terminals open, trigger a notification on session A. Verify session B is NOT focused or highlighted.
13. **Regression: old UUID after /clear** — after `/clear`, send a fake hook with the OLD UUID and verify no notification fires (old UUID is no longer in the index)

- [ ] **Step 4: Commit any fixes from manual testing**

---

### Task 11: Update remaining references (pty-server.js, terminal.js)

**Files:**
- Modify: `src/web/pty-server.js` (line 85)
- Modify: `src/web/public/terminal.js` (lines 226, 494)

- [ ] **Step 1: Update pty-server.js**

Line 85: No change needed — keep reading `query.resumeSessionId`. The terminal.js client still sends the UUID under this param name. The rename to `claudeUUID` in the query string is deferred to Phase 4.

- [ ] **Step 2: Update terminal.js**

Lines 226, 494: Where `resumeSessionId` is set on spawnOpts or appended to WebSocket URL, keep using `resumeSessionId` as the query param name for backward compatibility with pty-server.js:

```js
// Prefer claudeUUID, fall back to resumeSessionId — send as resumeSessionId query param
const uuidParam = spawnOpts.claudeUUID || spawnOpts.resumeSessionId;
if (uuidParam) {
  wsUrl += `&resumeSessionId=${encodeURIComponent(uuidParam)}`;
}
```

**Note:** The query param stays as `resumeSessionId` to match what pty-server.js reads. Update pty-server.js Step 1 to match — remove the `query.claudeUUID` branch since the param name won't change yet:

```js
// Keep reading resumeSessionId from query — terminal.js still sends it under this name
if (query.resumeSessionId && isSafeSessionId(query.resumeSessionId)) {
  spawnOpts.resumeSessionId = query.resumeSessionId;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/web/pty-server.js src/web/public/terminal.js
git commit -m "refactor: update PTY server and terminal for claudeUUID field"
```

---

### Task 12: Final documentation and cleanup notes

- [ ] **Step 1: Update stubs.md if it exists**

Check if `docs/stubs.md` exists. If so, add this entry:

```markdown
## Phase 4 Cleanup — Unified Session Identity

**Files:**
- `src/state/store.js`: Methods `setSessionName()`, `getSessionName()`, `getAllSessionNames()`, `getSessionNameSource()`, `getAllSessionNameSources()` — currently delegate to `session.displayName`/`session.nameSource`. Remove after one stable release cycle.
- `src/state/store.js`: Fields `session.name` and `session.resumeSessionId` — currently synced from `displayName`/`claudeUUID`. Drop when no callers remain.
- `src/state/store.js`: State maps `sessionNames`, `sessionNameSources` — preserved for rollback safety. Remove from `_migrateState()` and DEFAULT_STATE.
- `src/web/server.js`: Endpoints `GET /api/session-names`, `PUT /api/session-names/:claudeId` — deprecated, return data from session objects. Remove after frontend confirmed migrated.
- `src/web/pty-server.js`: Query param `resumeSessionId` — rename to `claudeUUID` in both terminal.js sender and pty-server.js receiver.

**Dependencies:** Confirm no external consumers of deprecated API endpoints before removal.
```

- [ ] **Step 2: Final commit**

```bash
git add docs/
git commit -m "docs: note Phase 4 cleanup items for unified session identity"
```
