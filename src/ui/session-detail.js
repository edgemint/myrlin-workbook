/**
 * Session Detail - Bottom right panel showing detailed info for a selected session.
 * Displays name, status, PID, working dir, topic, command, timestamps, and recent logs.
 */

const blessed = require('blessed');
const theme = require('./theme');

/**
 * Create the session detail widget
 * @param {blessed.screen} parent - The parent screen
 * @returns {blessed.box} The detail box widget
 */
function create(parent) {
  const panel = blessed.box({
    parent,
    label: ' Detail ',
    top: '50%',
    left: '30%',
    width: '70%',
    height: '50%-3', // above notification bar (3 rows)
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    vi: true,
    mouse: true,
    scrollbar: {
      ch: ' ',
      style: { bg: theme.colors.primaryDim },
    },
    border: theme.panel.border,
    style: theme.panel.style,
  });

  // Focus styling
  panel.on('focus', () => {
    panel.border = theme.panelFocused.border;
    panel.style.border = theme.panelFocused.style.border;
    panel.style.label = theme.panelFocused.style.label;
    panel.screen.render();
  });

  panel.on('blur', () => {
    panel.border = theme.panel.border;
    panel.style.border = theme.panel.style.border;
    panel.style.label = theme.panel.style.label;
    panel.screen.render();
  });

  return panel;
}

/**
 * Update the detail panel with session data
 * @param {blessed.box} panel - The detail box widget
 * @param {object|null} session - Session object, or null to clear
 */
function update(panel, session) {
  if (!session) {
    panel.setContent(`{${theme.colors.textTertiary}-fg}  Select a session to view details{/}`);
    return;
  }

  const { icon, color, label } = theme.formatStatus(session.status);
  const created = theme.formatTimestamp(session.createdAt);
  const lastActive = theme.formatTimestamp(session.lastActive);

  const labelColor = theme.colors.textSecondary;
  const valColor = theme.colors.text;
  const sep = `{${theme.colors.border}-fg}${'─'.repeat(40)}{/}`;

  let content = '';

  // Header
  content += ` {${theme.colors.primary}-fg}{bold}${session.displayName || session.name}{/bold}{/}\n`;
  content += ` {${color}-fg}${icon} ${label}{/}\n`;
  content += sep + '\n';

  // Key-value pairs
  const fields = [
    ['Status', `{${color}-fg}${icon} ${label}{/}`],
    ['PID', session.pid ? `{${valColor}-fg}${session.pid}{/}` : `{${theme.colors.textTertiary}-fg}none{/}`],
    ['Directory', `{${valColor}-fg}${session.workingDir || 'not set'}{/}`],
    ['Topic', `{${valColor}-fg}${session.topic || 'none'}{/}`],
    ['Command', `{${valColor}-fg}${session.command || 'claude'}{/}`],
    ['Created', `{${valColor}-fg}${created}{/}`],
    ['Last Active', `{${valColor}-fg}${lastActive}{/}`],
  ];

  for (const [key, val] of fields) {
    content += ` {${labelColor}-fg}${key.padEnd(13)}{/} ${val}\n`;
  }

  // Recent logs
  const logs = session.logs || [];
  if (logs.length > 0) {
    content += '\n' + sep + '\n';
    content += ` {${theme.colors.primary}-fg}{bold}Recent Logs{/bold}{/}\n`;
    const recentLogs = logs.slice(-5);
    for (const log of recentLogs) {
      const logTime = theme.formatTimestamp(log.time);
      content += ` {${theme.colors.textTertiary}-fg}${logTime}{/} {${theme.colors.textSecondary}-fg}${log.message}{/}\n`;
    }
  }

  panel.setContent(content);
}

module.exports = { create, update };
