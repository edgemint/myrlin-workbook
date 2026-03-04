/**
 * Test runner: starts the server inline, runs e2e-api.js tests, then exits.
 * Usage: node test/run-tests.js
 */
const { execSync } = require('child_process');
const path = require('path');
const http = require('http');

const PORT = 3458;
const cwd = path.join('C:', 'Projects', 'workbook');

// Start server inline, bind to 0.0.0.0 so localhost resolves correctly
process.env.CWM_PASSWORD = 'test123';
process.env.PORT = String(PORT);

const { startServer } = require(path.join(cwd, 'src', 'web', 'server'));
// Bind to all interfaces so 'localhost' in tests resolves correctly on Windows
const server = startServer(PORT, '0.0.0.0');

process.stderr.write('Server starting on port ' + PORT + ' (all interfaces)\n');

// Poll until the server is ready
function waitForServer(retries, cb) {
  const req = http.request({ host: '127.0.0.1', port: PORT, path: '/' }, (res) => {
    cb(null);
  });
  req.on('error', (e) => {
    if (retries <= 0) return cb(new Error('Server did not start after many retries'));
    setTimeout(() => waitForServer(retries - 1, cb), 500);
  });
  req.end();
}

waitForServer(20, (err) => {
  if (err) { process.stderr.write('Server failed to start: ' + err.message + '\n'); process.exit(1); }
  process.stderr.write('Server is ready. Running tests...\n');

  let exitCode = 0;
  try {
    // inherit stdio so test output goes directly to terminal
    execSync('node test/e2e-api.js', {
      env: { ...process.env, CWM_PASSWORD: 'test123', PORT: String(PORT) },
      cwd,
      timeout: 60000,
      stdio: 'inherit'
    });
  } catch (e) {
    exitCode = e.status || 1;
  }

  server.close(() => process.exit(exitCode));
  setTimeout(() => process.exit(exitCode), 3000);
});
