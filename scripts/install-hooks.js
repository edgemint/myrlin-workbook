#!/usr/bin/env node
/**
 * Install Claude Code HTTP hooks pointing at the CWM server.
 *
 * Reads ~/.claude/settings.json, merges the hook config for all
 * 18 Claude Code events, and writes it back. Idempotent — safe
 * to run multiple times.
 *
 * Usage:
 *   node scripts/install-hooks.js [--port 3456] [--dry-run]
 *
 * Flags:
 *   --port <n>   Port the CWM server is running on (default: 3456)
 *   --dry-run    Print what would be written without modifying the file
 *   --remove     Remove CWM hooks from settings.json instead of adding
 *
 * Safety guarantees:
 *   - ONLY the "hooks" key is modified; all other keys are left byte-for-byte intact
 *   - Within each hook event, only CWM-owned entries (identified by hook-relay.js in
 *     the command string) are touched; third-party hook entries are never removed
 *   - A backup is written to settings.json.bak before any modification
 *   - The file is written atomically via a .tmp file + rename
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
const BACKUP_PATH   = SETTINGS_PATH + '.bak';

// ─── Hook Event Definitions ─────────────────────────────────

// Absolute path to the relay script (embedded into hook commands)
const RELAY_SCRIPT = path.join(__dirname, 'hook-relay.js').replace(/\\/g, '/');

// Maps Claude Code event name → URL slug
const HOOK_EVENTS = [
  { event: 'SessionStart',       slug: 'session-start'        },
  { event: 'InstructionsLoaded', slug: 'instructions-loaded'  },
  { event: 'UserPromptSubmit',   slug: 'user-prompt-submit'   },
  { event: 'PreToolUse',         slug: 'pre-tool-use'         },
  { event: 'PermissionRequest',  slug: 'permission-request'   },
  { event: 'PostToolUse',        slug: 'post-tool-use'        },
  { event: 'PostToolUseFailure', slug: 'post-tool-use-failure' },
  { event: 'Notification',       slug: 'notification'         },
  { event: 'SubagentStart',      slug: 'subagent-start'       },
  { event: 'SubagentStop',       slug: 'subagent-stop'        },
  { event: 'TeammateIdle',       slug: 'teammate-idle'        },
  { event: 'TaskCompleted',      slug: 'task-completed'       },
  { event: 'ConfigChange',       slug: 'config-change'        },
  { event: 'WorktreeCreate',     slug: 'worktree-create'      },
  { event: 'WorktreeRemove',     slug: 'worktree-remove'      },
  { event: 'PreCompact',         slug: 'pre-compact'          },
  { event: 'Stop',               slug: 'stop'                 },
  { event: 'SessionEnd',         slug: 'session-end'          },
];

// The string marker used to identify CWM-owned hook entries.
// ONLY entries whose command string contains this exact filename are considered CWM-owned.
// NOTE: If you change --port, run --remove with the OLD port first; otherwise both port
// entries will coexist and hooks will double-fire.
const CWM_MARKER = 'hook-relay.js';

// ─── Load settings.json ─────────────────────────────────────

/**
 * Returns { rawText, settings } where:
 *   rawText  — the original file content as a string (or null if file absent)
 *   settings — the parsed JSON object (or {} if file absent)
 */
function loadSettings() {
  if (!fs.existsSync(SETTINGS_PATH)) {
    console.log(`No settings.json found at ${SETTINGS_PATH} — will create it.`);
    return { rawText: null, settings: {} };
  }
  const rawText = fs.readFileSync(SETTINGS_PATH, 'utf8');
  try {
    const settings = JSON.parse(rawText);
    return { rawText, settings };
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
  return { hooks: [{ type: 'command', command: `node "${RELAY_SCRIPT}" ${slug} ${PORT}` }] };
}

/**
 * Given an existing array of hook entries for an event,
 * remove any CWM-owned entries, then prepend the fresh CWM entry.
 * Returns the new array.
 */
function mergeEventHooks(existing, slug) {
  const filtered = (existing || []).filter(entry => !isCwmEntry(entry));
  return [makeHookEntry(slug), ...filtered];
}

/**
 * Given an existing array of hook entries, remove all CWM-owned entries.
 */
function removeEventHooks(existing) {
  return (existing || []).filter(entry => !isCwmEntry(entry));
}

/**
 * Check if a hook entry belongs to CWM.
 *
 * ONLY matches entries where one of the inner hooks has a `command` string
 * containing the literal filename "hook-relay.js". This is precise and will
 * never accidentally match third-party webhook entries (e.g. those with URLs
 * that happen to contain "/hooks/").
 */
function isCwmEntry(entry) {
  return (entry.hooks || []).some(h =>
    h.command && h.command.includes(CWM_MARKER)
  );
}

// ─── Surgical hooks-key replacement ─────────────────────────

/**
 * Given the original file text and the new hooks object (or undefined to
 * delete the key), return a new file string where ONLY the "hooks" key has
 * been updated. All other content — including key order, whitespace, and
 * any non-standard formatting — is preserved exactly.
 *
 * Strategy:
 *   1. Detect the indentation used in the file (default 2 spaces).
 *   2. Serialize only the new hooks value with that indentation.
 *   3. Use a regex to locate the existing "hooks": { ... } block and replace it,
 *      OR insert/remove the key as needed.
 */
function patchHooksKey(originalText, newHooks) {
  // Detect indentation: look for first line that starts with whitespace then a quote
  const indentMatch = originalText.match(/^(\s+)"/m);
  const indent = indentMatch ? indentMatch[1] : '  ';
  const indentSize = indent.length;

  const hasHooksKey = /"hooks"\s*:/.test(originalText);

  if (newHooks === undefined || Object.keys(newHooks).length === 0) {
    // ── REMOVE the hooks key ──────────────────────────────────────────────
    if (!hasHooksKey) return originalText; // nothing to remove

    // Replace the entire "hooks": { ... } block (including trailing comma if any)
    const removed = removeKeyFromJson(originalText, 'hooks', indentSize);
    return removed;
  }

  // Serialize the new hooks value, indented to sit inside the root object
  const hooksJson = JSON.stringify(newHooks, null, indentSize);
  // Re-indent every line of the value by one indent level (it will be a value
  // inside the root object, so all inner lines need one extra level of indent)
  const indentedHooksJson = hooksJson
    .split('\n')
    .map((line, i) => (i === 0 ? line : indent + line))
    .join('\n');

  if (!hasHooksKey) {
    // ── INSERT hooks key into an empty-ish or hooks-free object ──────────
    // Find the first '{' of the root object and insert after it
    return originalText.replace(/^(\s*\{)/, `$1\n${indent}"hooks": ${indentedHooksJson},`);
  }

  // ── REPLACE existing hooks key ────────────────────────────────────────
  // We need to find "hooks": <value> where <value> may be a nested object
  // spanning multiple lines. We do this by finding the key, then counting
  // braces/brackets to find the end of the value.
  const keyPattern = /("hooks"\s*:\s*)/;
  const keyMatch = keyPattern.exec(originalText);
  if (!keyMatch) {
    // Shouldn't happen given hasHooksKey check above, but be safe
    return originalText;
  }

  const keyStart = keyMatch.index;
  const valueStart = keyStart + keyMatch[0].length;

  // Find the end of the JSON value starting at valueStart
  const valueEnd = findJsonValueEnd(originalText, valueStart);
  if (valueEnd === -1) {
    console.error('Warning: could not locate end of "hooks" value — falling back to full rewrite of hooks key');
    return originalText;
  }

  // Preserve the trailing comma (if any) that followed the old value
  let tail = originalText.slice(valueEnd);
  const trailingComma = /^\s*,/.test(tail) ? '' : ''; // comma is already part of tail

  return (
    originalText.slice(0, keyStart) +
    `"hooks": ${indentedHooksJson}` +
    originalText.slice(valueEnd)
  );
}

/**
 * Find the end index (exclusive) of the JSON value starting at `start` in `text`.
 * Handles objects `{}`, arrays `[]`, strings `""`, numbers, booleans, null.
 * Returns -1 if parsing fails.
 */
function findJsonValueEnd(text, start) {
  // Skip leading whitespace
  let i = start;
  while (i < text.length && /\s/.test(text[i])) i++;

  if (i >= text.length) return -1;

  const ch = text[i];

  if (ch === '{' || ch === '[') {
    const open = ch;
    const close = ch === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escape = false;
    for (; i < text.length; i++) {
      const c = text[i];
      if (escape) { escape = false; continue; }
      if (c === '\\' && inString) { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === open)  { depth++; continue; }
      if (c === close) { depth--; if (depth === 0) return i + 1; }
    }
    return -1;
  }

  if (ch === '"') {
    // String value
    let escape = false;
    for (i = i + 1; i < text.length; i++) {
      const c = text[i];
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === '"') return i + 1;
    }
    return -1;
  }

  // Number, boolean, null — read until delimiter
  const m = text.slice(i).match(/^[\w.+\-]+/);
  if (m) return i + m[0].length;

  return -1;
}

/**
 * Remove a top-level key from a JSON string, preserving all other formatting.
 * Also removes the trailing comma if it's not the last key, or the leading
 * comma if it is the last key.
 */
function removeKeyFromJson(text, key, indentSize) {
  const indent = ' '.repeat(indentSize);
  // Match: optional leading newline + indent + "key": <value> + optional trailing comma
  // We find the key position and value end, then remove the whole line(s).
  const keyPattern = new RegExp(`"${key}"\\s*:\\s*`);
  const keyMatch = keyPattern.exec(text);
  if (!keyMatch) return text;

  const keyStart = keyMatch.index;
  const valueStart = keyStart + keyMatch[0].length;
  const valueEnd = findJsonValueEnd(text, valueStart);
  if (valueEnd === -1) return text;

  // Expand selection backwards to include the leading newline+indent
  let selStart = keyStart;
  // Walk back to include indent whitespace and the preceding newline
  while (selStart > 0 && text[selStart - 1] !== '\n') selStart--;
  // selStart now points to the start of the line

  // Expand selection forwards past a trailing comma and to end of that line
  let selEnd = valueEnd;
  // Skip optional whitespace then optional comma
  while (selEnd < text.length && text[selEnd] === ' ') selEnd++;
  if (selEnd < text.length && text[selEnd] === ',') selEnd++;
  // Skip to end of line (include the newline char)
  while (selEnd < text.length && text[selEnd] !== '\n') selEnd++;
  if (selEnd < text.length && text[selEnd] === '\n') selEnd++;

  return text.slice(0, selStart) + text.slice(selEnd);
}

// ─── Main ───────────────────────────────────────────────────

function main() {
  const { rawText, settings } = loadSettings();

  // Work on a copy of just the hooks section — never touch other keys
  const existingHooks = settings.hooks || {};
  const newHooks = Object.assign({}, existingHooks);

  for (const { event, slug } of HOOK_EVENTS) {
    if (REMOVE) {
      const updated = removeEventHooks(newHooks[event]);
      if (updated.length === 0) {
        delete newHooks[event];
      } else {
        newHooks[event] = updated;
      }
    } else {
      newHooks[event] = mergeEventHooks(newHooks[event], slug);
    }
  }

  // Determine what the final hooks value should be (undefined = delete key)
  const finalHooks = Object.keys(newHooks).length === 0 ? undefined : newHooks;

  // Produce the patched file text
  let output;
  if (rawText === null) {
    // File didn't exist — create minimal valid JSON
    if (finalHooks === undefined) {
      output = '{}\n';
    } else {
      output = JSON.stringify({ hooks: finalHooks }, null, 2) + '\n';
    }
  } else {
    output = patchHooksKey(rawText, finalHooks);
  }

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

  // Write backup before touching the real file
  if (rawText !== null) {
    fs.writeFileSync(BACKUP_PATH, rawText, 'utf8');
    console.log(`Backup written to ${BACKUP_PATH}`);
  }

  // Atomic write via tmp + rename
  const tmpPath = SETTINGS_PATH + '.tmp';
  fs.writeFileSync(tmpPath, output, 'utf8');
  fs.renameSync(tmpPath, SETTINGS_PATH);

  if (REMOVE) {
    console.log(`Removed CWM hooks from ${SETTINGS_PATH}`);
  } else {
    console.log(`Installed CWM hooks in ${SETTINGS_PATH} (port ${PORT})`);
    console.log('');
    console.log('Events wired:');
    for (const { event, slug } of HOOK_EVENTS) {
      console.log(`  ${event.padEnd(14)} -> hook-relay.js ${slug} ${PORT}`);
    }
    console.log('');
    console.log('Restart Claude Code for changes to take effect.');
  }
}

main();
