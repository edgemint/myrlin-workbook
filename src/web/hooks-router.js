/**
 * Express Router for Claude Code HTTP hook endpoints.
 *
 * Claude Code calls these URLs on lifecycle events (SessionStart,
 * PreToolUse, PostToolUse, Notification, Stop, SubagentStop).
 * No auth required — these are localhost-only calls from Claude Code.
 *
 * Mount with: app.use('/hooks', hooksRouter);
 */

'use strict';

const { Router } = require('express');

const router = Router();

// ANSI color helpers for readable console output
const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  cyan:    '\x1b[36m',
  yellow:  '\x1b[33m',
  green:   '\x1b[32m',
  magenta: '\x1b[35m',
  red:     '\x1b[31m',
  blue:    '\x1b[34m',
  gray:    '\x1b[90m',
};

const EVENT_COLORS = {
  'session-start':  C.green,
  'pre-tool-use':   C.yellow,
  'post-tool-use':  C.cyan,
  'notification':   C.blue,
  'stop':           C.magenta,
  'subagent-stop':  C.red,
};

/**
 * Pretty-print a hook payload to the console.
 * Truncates large nested objects (e.g. tool_input/tool_response) to avoid log spam.
 */
function logHookEvent(eventSlug, body) {
  const color = EVENT_COLORS[eventSlug] || C.gray;
  const label = eventSlug.toUpperCase().replace(/-/g, '_');
  const ts = new Date().toISOString();

  console.log(`\n${color}${C.bold}[HOOK] ${label}${C.reset}  ${C.gray}${ts}${C.reset}`);

  // Print key fields inline for fast scanning
  if (body.session_id)  console.log(`  ${C.gray}session_id:${C.reset}  ${body.session_id}`);
  if (body.cwd)         console.log(`  ${C.gray}cwd:${C.reset}         ${body.cwd}`);
  if (body.tool_name)   console.log(`  ${C.gray}tool_name:${C.reset}   ${body.tool_name}`);
  if (body.stop_reason) console.log(`  ${C.gray}stop_reason:${C.reset} ${body.stop_reason}`);
  if (body.cost_usd != null) console.log(`  ${C.gray}cost_usd:${C.reset}    $${body.cost_usd.toFixed(4)}`);
  if (body.message)     console.log(`  ${C.gray}message:${C.reset}     ${body.message}`);

  // Print full payload, truncating long leaf strings
  const sanitized = truncateDeep(body, 300);
  console.log(`  ${C.gray}payload:${C.reset}`, JSON.stringify(sanitized, null, 2).replace(/^/gm, '  '));
}

/**
 * Recursively truncate long string values in an object so logs stay readable.
 */
function truncateDeep(obj, maxLen) {
  if (typeof obj === 'string') return obj.length > maxLen ? obj.slice(0, maxLen) + '…' : obj;
  if (Array.isArray(obj))     return obj.map(v => truncateDeep(v, maxLen));
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = truncateDeep(v, maxLen);
    return out;
  }
  return obj;
}

// ─── Hook Endpoints ─────────────────────────────────────────

router.post('/session-start', (req, res) => {
  logHookEvent('session-start', req.body || {});
  res.json({ ok: true });
});

router.post('/pre-tool-use', (req, res) => {
  logHookEvent('pre-tool-use', req.body || {});
  res.json({ ok: true });
});

router.post('/post-tool-use', (req, res) => {
  logHookEvent('post-tool-use', req.body || {});
  res.json({ ok: true });
});

router.post('/notification', (req, res) => {
  logHookEvent('notification', req.body || {});
  res.json({ ok: true });
});

router.post('/stop', (req, res) => {
  logHookEvent('stop', req.body || {});
  res.json({ ok: true });
});

router.post('/subagent-stop', (req, res) => {
  logHookEvent('subagent-stop', req.body || {});
  res.json({ ok: true });
});

module.exports = { hooksRouter: router };
