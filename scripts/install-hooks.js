#!/usr/bin/env node
/**
 * Install Claude Code HTTP hooks pointing at the CWM server.
 *
 * Reads ~/.claude/settings.json, merges the hook config for all
 * six Claude Code events, and writes it back. Idempotent — safe
 * to run multiple times.
 *
 * Usage:
 *   node scripts/install-hooks.js [--port 3456] [--dry-run]
 *
 * Flags:
 *   --port <n>   Port the CWM server is running on (default: 3456)
 *   --dry-run    Print what would be written without modifying the file
 *   --remove     Remove CWM hooks from settings.json instead of adding
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ─── CLI Args ───────────────────────────────────────────────

const args = process.argv.slice(2);
const portArg = args.indexOf('--port');
const PORT    = portArg !== -1 ? parseInt(args[portArg + 1], 10) : 3456;
const DRY_RUN = args.includes('--dry-run');
const REMOVE  = args.includes('--remove');

if (isNaN(PORT) || PORT < 1 || PORT > 65535) {
  console.error('Error: --port must be a valid port number (1-65535)');
  process.exit(1);
}

// ─── Settings File Path ─────────────────────────────────────

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

// ─── Hook Event Definitions ─────────────────────────────────

const BASE_URL = `http://localhost:${PORT}`;

// Maps Claude Code event name → URL slug
const HOOK_EVENTS = [
  { event: 'SessionStart',  slug: 'session-start'  },
  { event: 'PreToolUse',    slug: 'pre-tool-use'   },
  { event: 'PostToolUse',   slug: 'post-tool-use'  },
  { event: 'Notification',  slug: 'notification'   },
  { event: 'Stop',          slug: 'stop'           },
  { event: 'SubagentStop',  slug: 'subagent-stop'  },
];

// The URL marker we use to identify CWM-owned hook entries
const CWM_MARKER = `/hooks/`;

// ─── Load settings.json ─────────────────────────────────────

function loadSettings() {
  if (!fs.existsSync(SETTINGS_PATH)) {
    console.log(`No settings.json found at ${SETTINGS_PATH} — will create it.`);
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch (e) {
    console.error(`Failed to parse ${SETTINGS_PATH}: ${e.message}`);
    process.exit(1);
  }
}

// ─── Merge logic ────────────────────────────────────────────

/**
 * Return the hook entry object for a given event slug.
 */
function makeHookEntry(slug) {
  return { hooks: [{ type: 'http', url: `${BASE_URL}/hooks/${slug}` }] };
}

/**
 * Given an existing array of hook entries for an event,
 * remove any CWM-owned entries, then prepend the fresh CWM entry.
 * Returns the new array.
 */
function mergeEventHooks(existing, slug) {
  // Filter out any existing CWM hook entries for this event
  const filtered = (existing || []).filter(entry => {
    const urls = (entry.hooks || []).map(h => h.url || '');
    return !urls.some(u => u.includes(CWM_MARKER));
  });
  return [makeHookEntry(slug), ...filtered];
}

/**
 * Given an existing array of hook entries, remove all CWM-owned entries.
 */
function removeEventHooks(existing) {
  return (existing || []).filter(entry => {
    const urls = (entry.hooks || []).map(h => h.url || '');
    return !urls.some(u => u.includes(CWM_MARKER));
  });
}

// ─── Main ───────────────────────────────────────────────────

function main() {
  const settings = loadSettings();

  if (!settings.hooks) settings.hooks = {};

  for (const { event, slug } of HOOK_EVENTS) {
    if (REMOVE) {
      settings.hooks[event] = removeEventHooks(settings.hooks[event]);
      if (settings.hooks[event].length === 0) delete settings.hooks[event];
    } else {
      settings.hooks[event] = mergeEventHooks(settings.hooks[event], slug);
    }
  }

  // Clean up empty hooks object
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

  const output = JSON.stringify(settings, null, 2) + '\n';

  if (DRY_RUN) {
    console.log('--- DRY RUN: would write to', SETTINGS_PATH, '---');
    console.log(output);
    return;
  }

  // Ensure ~/.claude exists
  const claudeDir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  fs.writeFileSync(SETTINGS_PATH, output, 'utf8');

  if (REMOVE) {
    console.log(`Removed CWM hooks from ${SETTINGS_PATH}`);
  } else {
    console.log(`Installed CWM hooks in ${SETTINGS_PATH} (port ${PORT})`);
    console.log('');
    console.log('Events wired:');
    for (const { event, slug } of HOOK_EVENTS) {
      console.log(`  ${event.padEnd(14)} -> ${BASE_URL}/hooks/${slug}`);
    }
    console.log('');
    console.log('Restart Claude Code for changes to take effect.');
  }
}

main();
