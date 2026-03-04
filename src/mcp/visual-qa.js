#!/usr/bin/env node
/**
 * Visual QA MCP Server
 *
 * Gives Claude "eyes and hands" for web UI development via Chrome DevTools Protocol.
 * Exposes 4 tools: screenshot, query_dom, execute_js, list_targets.
 *
 * Uses JSON-RPC 2.0 over stdio (MCP protocol) with chrome-remote-interface for CDP.
 * Works with any browser/Electron app that exposes a CDP debugging port.
 *
 * Environment:
 *   CDP_PORT=9222       Override the default CDP port
 *   CDP_HOST=localhost   Override the default CDP host
 *
 * Usage:
 *   node src/mcp/visual-qa.js                          # Default: localhost:9222
 *   CDP_PORT=9333 node src/mcp/visual-qa.js            # Custom port
 *
 * Part of tomnar's workbook (claude-workspace-manager).
 */

const readline = require('readline');
const CDP = require('chrome-remote-interface');

// ─── Configuration ────────────────────────────────────────

const CDP_PORT = parseInt(process.env.CDP_PORT, 10) || 9222;
const CDP_HOST = process.env.CDP_HOST || 'localhost';

/** Server metadata returned during MCP initialize handshake. */
const SERVER_INFO = {
  name: 'visual-qa',
  version: '1.0.0',
};

/** MCP protocol version we support. */
const PROTOCOL_VERSION = '2024-11-05';

// ─── Tool Definitions ─────────────────────────────────────

/**
 * MCP tool schemas returned by tools/list.
 * Each tool maps to a CDP operation for visual QA.
 */
const TOOLS = [
  {
    name: 'screenshot',
    description:
      'Capture a screenshot of the current page or a specific element. Returns a base64 PNG image. Use this to see what the UI looks like.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description:
            'Optional CSS selector to screenshot a specific element. Omit for full page.',
        },
        fullPage: {
          type: 'boolean',
          description:
            'If true, capture the full scrollable page. If false, capture only the viewport. Default: false.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'query_dom',
    description:
      'Query DOM elements by CSS selector. Returns tag, id, classes, text content, bounding rect, and key attributes for each match. Useful for understanding page structure without a screenshot.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector to query (e.g., ".header", "#app", "button").',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of elements to return. Default: 10.',
        },
      },
      required: ['selector'],
      additionalProperties: false,
    },
  },
  {
    name: 'execute_js',
    description:
      'Execute JavaScript in the page context. Use for live CSS injection, DOM manipulation, reading state, or any browser-side operation. Returns the serialized result.',
    inputSchema: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'JavaScript expression or code to evaluate in the page.',
        },
      },
      required: ['expression'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_targets',
    description:
      'List all available CDP targets (browser tabs, pages, workers). Use to find which page to connect to.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
];

// ─── CDP Connection (Lazy) ────────────────────────────────

/** @type {object|null} Active CDP client connection. */
let _client = null;

/**
 * Get or establish a CDP connection.
 * Lazy-connects on first call. Reconnects if the previous connection dropped.
 * @returns {Promise<object>} CDP client with Page, Runtime, DOM domains enabled.
 */
async function getClient() {
  if (_client) {
    try {
      // Verify connection is still alive with a lightweight call
      await _client.Runtime.evaluate({ expression: '1' });
      return _client;
    } catch {
      // Connection dropped, reconnect
      _client = null;
    }
  }

  const client = await CDP({ port: CDP_PORT, host: CDP_HOST });
  const { Page, Runtime, DOM } = client;

  // Enable the protocol domains we need
  await Page.enable();
  await Runtime.enable();
  await DOM.enable();

  _client = client;
  return client;
}

// ─── Tool Handlers ────────────────────────────────────────

/**
 * Capture a screenshot via CDP Page.captureScreenshot.
 * Optionally clips to a specific element's bounding box.
 * @param {object} args - Tool arguments (selector, fullPage).
 * @returns {Promise<object>} MCP content array with base64 image.
 */
async function handleScreenshot(args) {
  const client = await getClient();
  const { Page, Runtime } = client;

  const captureOpts = { format: 'png' };

  // If a selector is provided, clip to that element's bounding rect
  if (args.selector) {
    const boundsResult = await Runtime.evaluate({
      expression: `(() => {
        const el = document.querySelector(${JSON.stringify(args.selector)});
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      })()`,
      returnByValue: true,
    });

    const bounds = boundsResult.result.value;
    if (!bounds) {
      return {
        content: [{ type: 'text', text: `No element found matching selector: ${args.selector}` }],
        isError: true,
      };
    }
    captureOpts.clip = { ...bounds, scale: 1 };
  }

  // Full-page capture: measure full document height and set viewport
  if (args.fullPage && !args.selector) {
    const metricsResult = await Runtime.evaluate({
      expression: `(() => {
        const body = document.body;
        const html = document.documentElement;
        return {
          width: Math.max(body.scrollWidth, html.scrollWidth, html.clientWidth),
          height: Math.max(body.scrollHeight, html.scrollHeight, html.clientHeight)
        };
      })()`,
      returnByValue: true,
    });

    const metrics = metricsResult.result.value;
    if (metrics) {
      captureOpts.clip = { x: 0, y: 0, width: metrics.width, height: metrics.height, scale: 1 };
    }
  }

  const { data } = await Page.captureScreenshot(captureOpts);

  return {
    content: [{ type: 'image', data, mimeType: 'image/png' }],
  };
}

/**
 * Query DOM elements and return structural info.
 * @param {object} args - Tool arguments (selector, limit).
 * @returns {Promise<object>} MCP content array with JSON element data.
 */
async function handleQueryDom(args) {
  const client = await getClient();
  const { Runtime } = client;

  const limit = args.limit || 10;

  const result = await Runtime.evaluate({
    expression: `(() => {
      const els = Array.from(document.querySelectorAll(${JSON.stringify(args.selector)}));
      return els.slice(0, ${limit}).map(el => {
        const r = el.getBoundingClientRect();
        const text = (el.textContent || '').trim().slice(0, 200);
        const attrs = {};
        for (const a of el.attributes) {
          if (['id', 'class', 'href', 'src', 'type', 'name', 'value', 'placeholder', 'role', 'aria-label', 'data-testid'].includes(a.name)) {
            attrs[a.name] = a.value;
          }
        }
        return {
          tag: el.tagName.toLowerCase(),
          id: el.id || undefined,
          classes: el.className ? el.className.split(' ').filter(Boolean) : [],
          text: text || undefined,
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          attrs: Object.keys(attrs).length > 0 ? attrs : undefined
        };
      });
    })()`,
    returnByValue: true,
  });

  if (result.exceptionDetails) {
    return {
      content: [{ type: 'text', text: `DOM query error: ${result.exceptionDetails.text}` }],
      isError: true,
    };
  }

  const elements = result.result.value || [];
  return {
    content: [{ type: 'text', text: JSON.stringify(elements, null, 2) }],
  };
}

/**
 * Execute arbitrary JavaScript in the page context.
 * @param {object} args - Tool arguments (expression).
 * @returns {Promise<object>} MCP content array with serialized result.
 */
async function handleExecuteJs(args) {
  const client = await getClient();
  const { Runtime } = client;

  const result = await Runtime.evaluate({
    expression: args.expression,
    returnByValue: true,
    awaitPromise: true,
  });

  if (result.exceptionDetails) {
    const errMsg =
      result.exceptionDetails.exception?.description ||
      result.exceptionDetails.text ||
      'Unknown error';
    return {
      content: [{ type: 'text', text: `JS Error: ${errMsg}` }],
      isError: true,
    };
  }

  // Serialize the result value
  const value = result.result.value;
  let text;
  if (value === undefined) {
    text = 'undefined';
  } else if (value === null) {
    text = 'null';
  } else if (typeof value === 'object') {
    text = JSON.stringify(value, null, 2);
  } else {
    text = String(value);
  }

  return {
    content: [{ type: 'text', text }],
  };
}

/**
 * List all available CDP targets (tabs, pages, service workers, etc.).
 * @returns {Promise<object>} MCP content array with target list.
 */
async function handleListTargets() {
  const targets = await CDP.List({ port: CDP_PORT, host: CDP_HOST });

  const simplified = targets.map((t) => ({
    id: t.id,
    type: t.type,
    title: t.title,
    url: t.url,
  }));

  return {
    content: [{ type: 'text', text: JSON.stringify(simplified, null, 2) }],
  };
}

/**
 * Route a tool call to the appropriate handler.
 * @param {string} name - Tool name.
 * @param {object} args - Tool arguments.
 * @returns {Promise<object>} MCP tool result.
 */
async function handleToolCall(name, args) {
  switch (name) {
    case 'screenshot':
      return handleScreenshot(args || {});
    case 'query_dom':
      return handleQueryDom(args || {});
    case 'execute_js':
      return handleExecuteJs(args || {});
    case 'list_targets':
      return handleListTargets();
    default:
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
}

// ─── JSON-RPC 2.0 Transport ──────────────────────────────

/**
 * Send a JSON-RPC response to stdout.
 * @param {object} msg - JSON-RPC response object.
 */
function sendResponse(msg) {
  const json = JSON.stringify(msg);
  process.stdout.write(json + '\n');
}

/**
 * Handle an incoming JSON-RPC request.
 * Implements the MCP protocol subset: initialize, notifications/initialized,
 * tools/list, tools/call, and ping.
 * @param {object} request - Parsed JSON-RPC request.
 */
async function handleRequest(request) {
  const { id, method, params } = request;

  // Notifications (no id) - just acknowledge silently
  if (id === undefined || id === null) {
    return;
  }

  switch (method) {
    case 'initialize':
      sendResponse({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        },
      });
      break;

    case 'ping':
      sendResponse({ jsonrpc: '2.0', id, result: {} });
      break;

    case 'tools/list':
      sendResponse({
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS },
      });
      break;

    case 'tools/call': {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      try {
        const result = await handleToolCall(toolName, toolArgs);
        sendResponse({ jsonrpc: '2.0', id, result });
      } catch (err) {
        // CDP connection errors get a helpful message
        const errMsg = err.code === 'ECONNREFUSED'
          ? `Cannot connect to CDP at ${CDP_HOST}:${CDP_PORT}. Launch browser with --remote-debugging-port=${CDP_PORT} or use "npm run gui -- --cdp".`
          : `Tool error: ${err.message}`;
        sendResponse({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: errMsg }],
            isError: true,
          },
        });
      }
      break;
    }

    default:
      sendResponse({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
  }
}

// ─── Main: stdio readline loop ────────────────────────────

/** Track in-flight requests so we don't exit mid-response. */
let _pendingRequests = 0;
/** True once stdin has closed (EOF received). */
let _stdinClosed = false;

/**
 * Clean up CDP connection and exit.
 * Only exits when all pending requests have completed.
 */
function shutdownIfReady() {
  if (_stdinClosed && _pendingRequests === 0) {
    if (_client) {
      _client.close().catch(() => {});
    }
    process.exit(0);
  }
}

/**
 * Start the MCP server. Reads JSON-RPC messages from stdin line-by-line,
 * dispatches to handleRequest, and writes responses to stdout.
 */
function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let request;
    try {
      request = JSON.parse(trimmed);
    } catch {
      sendResponse({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      });
      return;
    }

    _pendingRequests++;
    try {
      await handleRequest(request);
    } finally {
      _pendingRequests--;
      shutdownIfReady();
    }
  });

  rl.on('close', () => {
    // stdin closed - mark for shutdown, but wait for in-flight requests
    _stdinClosed = true;
    shutdownIfReady();
  });

  // Log to stderr (safe - doesn't interfere with JSON-RPC on stdout)
  process.stderr.write(`[visual-qa] MCP server started. CDP target: ${CDP_HOST}:${CDP_PORT}\n`);
}

main();
