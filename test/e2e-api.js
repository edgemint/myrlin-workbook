#!/usr/bin/env node
/**
 * E2E API test suite. Requires the server to be running on PORT.
 * Usage: CWM_PASSWORD=test123 PORT=3458 node test/e2e-api.js
 *
 * Tests auth, workspaces, sessions, docs, conflicts, templates,
 * discovery, search, cost, SSE, static files, and error handling.
 */

const http = require('http');
const PORT = process.env.PORT || 3458;
const PASSWORD = process.env.CWM_PASSWORD || 'test123';
const BASE = `http://localhost:${PORT}`;

let TOKEN = '';

/** Send an HTTP request, auto-attaching auth token if available */
function request(method, path, body, customHeaders) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json', ...customHeaders };
    if (TOKEN && !customHeaders?.Authorization) headers['Authorization'] = `Bearer ${TOKEN}`;
    const req = http.request(BASE + path, { method, headers }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

const get = (p, h) => request('GET', p, null, h);
const post = (p, b, h) => request('POST', p, b, h);
const del = (p, h) => request('DELETE', p, null, h);
const put = (p, b, h) => request('PUT', p, b, h);

/** Safe JSON parse */
function json(r) {
  try { return JSON.parse(r.body); } catch { return null; }
}

async function run() {
  const results = [];
  function check(name, ok) {
    results.push([name, ok]);
    console.log((ok ? '  PASS' : '  FAIL') + '  ' + name);
  }

  // ════════════════════════════════════════
  // AUTH - Login first to avoid rate limiting on reruns
  // ════════════════════════════════════════
  console.log('\n--- Authentication ---');

  // Unauthenticated access (no login attempt, no rate limit hit)
  let r = await get('/api/workspaces', { Authorization: '' });
  check('Unauthenticated GET /api/workspaces → 401', r.status === 401);

  // Invalid token (no login attempt)
  r = await get('/api/workspaces', { Authorization: 'Bearer fake-token-12345' });
  check('Invalid token → 401', r.status === 401);

  // Good login (first login attempt)
  r = await post('/api/auth/login', { password: PASSWORD });
  const loginData = json(r);
  TOKEN = (loginData && loginData.token) || '';
  check('POST /api/auth/login → 200 + token', r.status === 200 && TOKEN.length > 0);

  if (!TOKEN) {
    console.error('\nFATAL: Could not authenticate. Is the server running with CWM_PASSWORD=' + PASSWORD + '?');
    console.error('Response:', r.status, r.body);
    process.exit(1);
  }

  r = await get('/api/auth/check');
  check('GET /api/auth/check → 200', r.status === 200);

  // ════════════════════════════════════════
  // WORKSPACES
  // ════════════════════════════════════════
  console.log('\n--- Workspaces ---');
  r = await get('/api/workspaces');
  const wsData = json(r);
  const wsList = wsData.workspaces || wsData;
  const initialWsCount = Array.isArray(wsList) ? wsList.length : 0;
  check('GET /api/workspaces → list (' + initialWsCount + ')', r.status === 200 && Array.isArray(wsList));

  // Create workspace
  r = await post('/api/workspaces', { name: 'E2E Test WS', description: 'Automated test' });
  const newWs = (json(r).workspace || json(r));
  check('POST /api/workspaces → 201 + id', r.status === 201 && !!newWs.id);

  // Verify workspace count increased
  r = await get('/api/workspaces');
  const wsAfter = (json(r).workspaces || json(r));
  check('Workspace count increased by 1', wsAfter.length === initialWsCount + 1);

  // Get single workspace
  r = await get('/api/workspaces/' + newWs.id);
  check('GET /api/workspaces/:id → 200', r.status === 200);

  // Update workspace
  r = await put('/api/workspaces/' + newWs.id, { name: 'E2E Updated', description: 'Updated description' });
  check('PUT /api/workspaces/:id → 200', r.status === 200);

  // Verify update persisted
  r = await get('/api/workspaces/' + newWs.id);
  const updatedWs = json(r).workspace || json(r);
  check('Workspace name updated', updatedWs.name === 'E2E Updated');

  // Get non-existent workspace
  r = await get('/api/workspaces/non-existent-id-12345');
  check('GET non-existent workspace → 404', r.status === 404);

  // Create workspace without name
  r = await post('/api/workspaces', { description: 'No name' });
  check('Create workspace without name → 400', r.status === 400);

  // ════════════════════════════════════════
  // SESSIONS
  // ════════════════════════════════════════
  console.log('\n--- Sessions ---');
  r = await get('/api/sessions');
  const sessData = json(r);
  const sessList = sessData.sessions || sessData;
  check('GET /api/sessions → list (' + (Array.isArray(sessList) ? sessList.length : '?') + ')', r.status === 200);

  // Create session in test workspace
  let newSessId = null;
  r = await post('/api/sessions', { name: 'e2e-test-session', workspaceId: newWs.id, topic: 'E2E testing' });
  const newSess = (json(r).session || json(r));
  newSessId = newSess.id;
  check('POST /api/sessions → 201 + id', r.status === 201 && !!newSessId);

  // Verify session has correct workspace
  check('Session linked to workspace', newSess.workspaceId === newWs.id);

  // Rename session
  if (newSessId) {
    r = await put('/api/sessions/' + newSessId, { name: 'e2e-renamed' });
    check('PUT /api/sessions/:id → 200', r.status === 200);
    const renamedSess = (json(r).session || json(r));
    check('Session name updated', renamedSess.name === 'e2e-renamed');
  }

  // Create second session
  r = await post('/api/sessions', { name: 'e2e-session-2', workspaceId: newWs.id });
  const sess2 = (json(r).session || json(r));
  const sess2Id = sess2.id;
  check('Create second session in workspace', r.status === 201 && !!sess2Id);

  // Get non-existent session
  r = await get('/api/sessions/non-existent-session-id');
  check('GET non-existent session → 404', r.status === 404);

  // ════════════════════════════════════════
  // WORKSPACE DOCS (all types)
  // ════════════════════════════════════════
  console.log('\n--- Workspace Docs ---');
  r = await get('/api/workspaces/' + newWs.id + '/docs');
  check('GET /api/workspaces/:id/docs → 200', r.status === 200);

  // Test each doc type
  const docTypes = [
    { type: 'notes', text: '# E2E Notes\nTesting notes feature' },
    { type: 'goals', text: '- Goal 1: Ship v1.0\n- Goal 2: Add tests' },
    { type: 'tasks', text: '- [ ] Task 1\n- [x] Task 2 done' },
    { type: 'rules', text: '1. Always test\n2. Never skip tests' },
    { type: 'roadmap', text: '## Phase 1\n- MVP features' },
  ];

  for (const { type, text } of docTypes) {
    r = await post('/api/workspaces/' + newWs.id + '/docs/' + type, { text });
    check('POST docs/' + type + ' → 201', r.status === 201);
  }

  // Verify all docs persisted
  r = await get('/api/workspaces/' + newWs.id + '/docs');
  const allDocs = json(r);
  for (const { type } of docTypes) {
    const docArr = allDocs[type];
    check('Docs ' + type + ' persisted', Array.isArray(docArr) && docArr.length > 0);
  }

  // Invalid doc type
  r = await post('/api/workspaces/' + newWs.id + '/docs/invalid_type', { text: 'bad' });
  check('POST invalid doc type → 400/404', r.status === 400 || r.status === 404);

  // Docs for non-existent workspace
  r = await get('/api/workspaces/nonexistent-ws/docs');
  check('Docs for non-existent workspace → 404', r.status === 404);

  // ════════════════════════════════════════
  // CONFLICTS
  // ════════════════════════════════════════
  console.log('\n--- Conflicts ---');
  r = await get('/api/workspaces/' + newWs.id + '/conflicts');
  check('GET /api/workspaces/:id/conflicts → 200', r.status === 200);
  const conflicts = json(r);
  check('Conflicts response is valid', Array.isArray(conflicts.conflicts || conflicts));

  // ════════════════════════════════════════
  // TEMPLATES (full CRUD)
  // ════════════════════════════════════════
  console.log('\n--- Templates ---');
  r = await get('/api/templates');
  check('GET /api/templates → 200', r.status === 200);

  // Create template
  r = await post('/api/templates', { name: 'E2E Template', command: 'claude', flags: ['--model', 'sonnet'] });
  const tplResp = json(r);
  const tpl = tplResp.template || tplResp;
  check('POST /api/templates → create', r.status === 200 || r.status === 201);

  // Get templates - should include our new one
  r = await get('/api/templates');
  const tplsAfter = json(r);
  const tplList = tplsAfter.templates || tplsAfter;
  const found = Array.isArray(tplList) && tplList.some(t => t.name === 'E2E Template');
  check('New template in list', found);

  // Delete template (if ID available)
  if (tpl && tpl.id) {
    r = await del('/api/templates/' + tpl.id);
    check('DELETE /api/templates/:id', r.status === 200);
  }

  // ════════════════════════════════════════
  // DISCOVERY
  // ════════════════════════════════════════
  console.log('\n--- Discovery ---');
  r = await get('/api/discover');
  check('GET /api/discover → 200', r.status === 200);
  if (r.status === 200) {
    const disc = json(r);
    const projCount = disc.projects ? disc.projects.length : (Array.isArray(disc) ? disc.length : '?');
    console.log('    Found ' + projCount + ' projects');
    check('Discovery returns array', Array.isArray(disc.projects || disc));
  }

  // ════════════════════════════════════════
  // SEARCH
  // ════════════════════════════════════════
  console.log('\n--- Search ---');
  r = await get('/api/search?q=test');
  check('GET /api/search?q=test → 200', r.status === 200);
  if (r.status === 200) {
    const sr = json(r);
    console.log('    Found ' + (sr.results || []).length + ' results');
  }

  // Empty search
  r = await get('/api/search?q=');
  check('GET /api/search with empty q → 200/400', r.status === 200 || r.status === 400);

  // Search for non-existent term
  r = await get('/api/search?q=zzzzxxxxxnoexist99999');
  check('Search non-existent term → 200 with 0 results', r.status === 200);
  if (r.status === 200) {
    const sr = json(r);
    check('Non-existent search returns 0 results', (sr.results || []).length === 0);
  }

  // ════════════════════════════════════════
  // COST TRACKING
  // ════════════════════════════════════════
  console.log('\n--- Cost Tracking ---');
  r = await get('/api/cost/dashboard');
  check('GET /api/cost/dashboard → 200', r.status === 200);
  if (r.status === 200) {
    const cost = json(r);
    check('Cost has summary', !!cost.summary);
    check('Cost has timeline', !!cost.timeline);
    check('Cost has byModel', !!cost.byModel);
    check('Cost has byWorkspace', !!cost.byWorkspace);
    check('Cost has sessions', !!cost.sessions);
    console.log('    Keys:', Object.keys(cost).join(', '));
  }

  // ════════════════════════════════════════
  // SSE (connect/disconnect test)
  // ════════════════════════════════════════
  console.log('\n--- SSE ---');
  const sseOk = await new Promise((resolve) => {
    const req = http.request(BASE + '/api/events?token=' + TOKEN, { method: 'GET' }, (res) => {
      const ok = res.statusCode === 200 && (res.headers['content-type'] || '').includes('text/event-stream');
      res.destroy();
      resolve(ok);
    });
    req.on('error', () => resolve(false));
    req.end();
    setTimeout(() => { req.destroy(); resolve(false); }, 3000);
  });
  check('SSE endpoint connects (text/event-stream)', sseOk);

  // ════════════════════════════════════════
  // STATIC FILES
  // ════════════════════════════════════════
  console.log('\n--- Static Files ---');
  r = await get('/');
  check('GET / serves HTML', r.status === 200 && r.body.includes('<!DOCTYPE html'));

  r = await get('/app.js');
  check('GET /app.js serves JS', r.status === 200 && r.body.includes('class'));

  r = await get('/styles.css');
  check('GET /styles.css serves CSS', r.status === 200 && r.body.includes('{'));

  r = await get('/nonexistent.xyz');
  check('GET /nonexistent.xyz → fallback or 404', r.status === 200 || r.status === 404);

  // ════════════════════════════════════════
  // QUOTA OVERVIEW
  // ════════════════════════════════════════
  console.log('\n--- Quota Overview ---');
  r = await get('/api/quota-overview');
  check('GET /api/quota-overview → 200', r.status === 200);

  // ════════════════════════════════════════
  // PROJECT DEFAULTS
  // ════════════════════════════════════════
  console.log('\n--- Project Defaults ---');

  r = await get('/api/project-defaults');
  check('GET /api/project-defaults returns object', r.status === 200 && typeof json(r) === 'object');

  r = await put('/api/project-defaults/test-encoded-name', { defaultDir: 'C:/Projects/test' });
  check('PUT /api/project-defaults sets defaultDir', r.status === 200 && json(r)?.success === true);

  r = await get('/api/project-defaults');
  check('GET /api/project-defaults contains saved entry', json(r)?.['test-encoded-name']?.defaultDir === 'C:/Projects/test');

  r = await put('/api/project-defaults/test-encoded-name', { defaultDir: '' });
  check('PUT /api/project-defaults can clear defaultDir', r.status === 200 && json(r)?.success === true);

  // ════════════════════════════════════════
  // CLEANUP
  // ════════════════════════════════════════
  console.log('\n--- Cleanup ---');

  // Delete second session
  if (sess2Id) {
    r = await del('/api/sessions/' + sess2Id);
    check('DELETE session 2', r.status === 200);
  }

  // Delete first session
  if (newSessId) {
    r = await del('/api/sessions/' + newSessId);
    check('DELETE session 1', r.status === 200);
  }

  // Delete already-deleted session
  if (newSessId) {
    r = await del('/api/sessions/' + newSessId);
    check('DELETE already-deleted session → 404', r.status === 404);
  }

  // Delete workspace
  if (newWs.id) {
    r = await del('/api/workspaces/' + newWs.id);
    check('DELETE workspace', r.status === 200);

    r = await get('/api/workspaces/' + newWs.id);
    check('Workspace gone after delete → 404', r.status === 404);

    r = await del('/api/workspaces/' + newWs.id);
    check('DELETE already-deleted workspace → 404', r.status === 404);
  }

  // ════════════════════════════════════════
  // AUTH ERROR CASES (tested last to avoid rate limiting)
  // ════════════════════════════════════════
  console.log('\n--- Auth Error Cases ---');

  // Bad password (2nd login attempt in this test run)
  r = await post('/api/auth/login', { password: 'wrong-password' });
  check('Login with wrong password → 403', r.status === 403);

  // Missing password (3rd login attempt)
  r = await post('/api/auth/login', {});
  check('Login with no password → 400', r.status === 400);

  // ════════════════════════════════════════
  // LOGOUT (last so error cases above still have auth)
  // ════════════════════════════════════════
  console.log('\n--- Logout ---');
  r = await post('/api/auth/logout');
  check('POST /api/auth/logout → 200', r.status === 200);

  r = await get('/api/auth/check');
  const authAfterLogout = json(r);
  check('Token invalid after logout', r.status === 401 || (authAfterLogout && authAfterLogout.authenticated === false));

  // Verify API access revoked after logout
  r = await get('/api/workspaces');
  check('API access denied after logout', r.status === 401);

  // ════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════
  console.log('\n=============================');
  let pass = 0, fail = 0;
  const failures = [];
  for (const [name, ok] of results) {
    if (ok) pass++; else { fail++; failures.push(name); }
  }
  console.log(`${pass} passed, ${fail} failed, ${results.length} total`);
  if (failures.length > 0) {
    console.log('\nFailed tests:');
    failures.forEach(f => console.log('  - ' + f));
  }
  if (fail > 0) process.exit(1);
}

run().catch(e => { console.error('Fatal:', e); process.exit(1); });
