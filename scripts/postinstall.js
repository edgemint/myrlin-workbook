#!/usr/bin/env node
/**
 * Postinstall script: fix node-pty spawn-helper permissions on macOS/Linux.
 * The prebuilt spawn-helper binary ships without execute permission (644),
 * causing posix_spawnp failures. This sets it to 755.
 * See: https://github.com/therealarthur/tomnar-workbook/issues/4
 */
'use strict';

if (process.platform === 'win32') {
  process.exit(0);
}

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const prebuildsDir = path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds');

if (!fs.existsSync(prebuildsDir)) {
  process.exit(0);
}

try {
  // Find all spawn-helper binaries across platform dirs and chmod +x them
  const dirs = fs.readdirSync(prebuildsDir, { withFileTypes: true })
    .filter(d => d.isDirectory());

  for (const dir of dirs) {
    const helper = path.join(prebuildsDir, dir.name, 'spawn-helper');
    if (fs.existsSync(helper)) {
      execSync(`chmod +x "${helper}"`, { stdio: 'ignore' });
    }
  }
} catch (_) {
  // Non-fatal: if chmod fails, user can still manually fix
}
