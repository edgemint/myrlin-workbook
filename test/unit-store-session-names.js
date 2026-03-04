#!/usr/bin/env node
// Quick unit test for Store.setSessionName / getSessionName / getAllSessionNames
const { Store } = require('../src/state/store');
// Note: store.js resolves STATE_DIR at module load from __dirname — it cannot be redirected
// via env var. The 150ms debounce means no disk write occurs before process exit, so
// these in-memory tests are safe to run without a temp directory.
const store = new Store();
store.init();

let pass = 0, fail = 0;
function check(label, ok) {
  if (ok) { console.log('  PASS  ' + label); pass++; }
  else     { console.log('  FAIL  ' + label); fail++; }
}

check('getSessionName on unknown UUID returns null',
  store.getSessionName('no-such-uuid') === null);

store.setSessionName('uuid-aaa', 'My Test Session');
check('setSessionName stores the name',
  store.getSessionName('uuid-aaa') === 'My Test Session');

store.setSessionName('uuid-bbb', 'Another Session');
const all = store.getAllSessionNames();
check('getAllSessionNames returns both entries',
  all['uuid-aaa'] === 'My Test Session' && all['uuid-bbb'] === 'Another Session');

check('setSessionName with empty name is a no-op',
  (() => { store.setSessionName('uuid-aaa', ''); return store.getSessionName('uuid-aaa') === 'My Test Session'; })());

check('setSessionName with non-string UUID is a no-op',
  (() => { store.setSessionName(null, 'x'); return store.getSessionName(null) === null; })());

// Source tracking
check('setSessionName default source is manual',
  (() => { store.setSessionName('uuid-ccc', 'Manual Name'); return store.getSessionNameSource('uuid-ccc') === 'manual'; })());

check('setSessionName with explicit auto source',
  (() => { store.setSessionName('uuid-ddd', 'Auto Name', 'auto'); return store.getSessionNameSource('uuid-ddd') === 'auto'; })());

check('auto source does not overwrite manual source',
  (() => {
    store.setSessionName('uuid-eee', 'Manual Name', 'manual');
    const result = store.setSessionName('uuid-eee', 'Auto Override', 'auto');
    return result === null && store.getSessionName('uuid-eee') === 'Manual Name';
  })());

check('manual source can overwrite auto source',
  (() => {
    store.setSessionName('uuid-fff', 'Auto Name', 'auto');
    store.setSessionName('uuid-fff', 'Manual Name', 'manual');
    return store.getSessionName('uuid-fff') === 'Manual Name' && store.getSessionNameSource('uuid-fff') === 'manual';
  })());

check('getSessionNameSource returns null for unknown UUID',
  store.getSessionNameSource('no-such-uuid') === null);

check('getAllSessionNameSources includes new entries',
  (() => {
    const sources = store.getAllSessionNameSources();
    return sources['uuid-ccc'] === 'manual' && sources['uuid-ddd'] === 'auto';
  })());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
