#!/usr/bin/env node
/**
 * Relay Claude Code hook payloads to the CWM server.
 *
 * Reads JSON from stdin, POSTs it to http://localhost:{PORT}/hooks/{SLUG}.
 * Exits 0 silently on any error (server down, timeout, etc.) so Claude Code
 * never shows hook failure warnings when CWM is offline.
 *
 * Usage (called by Claude Code hooks, not directly):
 *   echo '{"session_id":"..."}' | node hook-relay.js <slug> [port]
 */

'use strict';

const http = require('http');

const slug = process.argv[2];
const port = parseInt(process.argv[3], 10) || 3456;

if (!slug) process.exit(0);

// Read stdin
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const req = http.request({
    hostname: '127.0.0.1',
    port,
    path: `/hooks/${slug}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    timeout: 2000,
  }, (res) => {
    // Drain response and exit
    res.resume();
    res.on('end', () => process.exit(0));
  });

  req.on('error', () => process.exit(0));
  req.on('timeout', () => { req.destroy(); process.exit(0); });

  req.write(input || '{}');
  req.end();
});

// If stdin closes immediately with no data, still exit cleanly
process.stdin.on('error', () => process.exit(0));
