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
