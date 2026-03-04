#!/usr/bin/env node
// Quick unit test for Store.setSessionName / getSessionName / getAllSessionNames
const os = require('os');
const fs = require('fs');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwm-test-'));

const { Store } = require('../src/state/store');
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

console.log(`\n${pass} passed, ${fail} failed`);
fs.rmSync(tmpDir, { recursive: true, force: true });
process.exit(fail > 0 ? 1 : 0);
