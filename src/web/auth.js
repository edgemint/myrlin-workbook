/**
 * Authentication module for Claude Workspace Manager Web API.
 * Uses a simple in-memory token approach with Bearer token auth.
 *
 * - POST /api/auth/login - Validates password, returns a Bearer token
 * - POST /api/auth/logout - Invalidates the token
 * - GET  /api/auth/check - Validates current token
 * - GET  /api/auth/config - Returns whether auth is required (public, pre-auth bootstrap)
 * - POST /api/auth/config - Update requireAuth setting (protected)
 *
 * Protected routes use the requireAuth middleware which checks
 * the Authorization: Bearer <token> header.
 *
 * Password is loaded from (in priority order):
 *   1. CWM_PASSWORD environment variable
 *   2. ~/.tomnar/config.json (persists across npx updates/reinstalls)
 *   3. ./state/config.json (local project config)
 *   4. Auto-generated on first run (saved to both locations)
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Configuration ─────────────────────────────────────────
const TOKEN_BYTE_LENGTH = 32;
const HOME_CONFIG_DIR = path.join(os.homedir(), '.tomnar');
const HOME_CONFIG_FILE = path.join(HOME_CONFIG_DIR, 'config.json');
const LOCAL_CONFIG_DIR = path.join(__dirname, '..', '..', 'state');
const LOCAL_CONFIG_FILE = path.join(LOCAL_CONFIG_DIR, 'config.json');

// ─── Rate Limiting ─────────────────────────────────────────
// Simple in-memory rate limiter: max 5 login attempts per IP per 60 seconds
const LOGIN_RATE_LIMIT = 5;
const LOGIN_RATE_WINDOW_MS = 60 * 1000; // 1 minute
const loginAttempts = new Map(); // IP -> { count, resetAt }

/**
 * Check if a login attempt from this IP should be rate-limited.
 * @param {string} ip - Client IP address
 * @returns {boolean} true if rate limited (should reject)
 */
function isRateLimited(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);

  if (!entry || now > entry.resetAt) {
    // Window expired or new IP - start fresh
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_RATE_WINDOW_MS });
    return false;
  }

  entry.count++;
  if (entry.count > LOGIN_RATE_LIMIT) {
    return true;
  }
  return false;
}

// Clean up stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts) {
    if (now > entry.resetAt) {
      loginAttempts.delete(ip);
    }
  }
}, 5 * 60 * 1000).unref();

// ─── Password Management ──────────────────────────────────

/**
 * Read password from a config file, returns null if not found.
 * @param {string} filePath - Path to config.json
 * @returns {string|null}
 */
function readPasswordFromFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const config = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (config.password && typeof config.password === 'string') {
        return config.password;
      }
    }
  } catch (_) {
    // Corrupted config - skip
  }
  return null;
}

/**
 * Read requireAuth flag from a config file. Defaults to true if absent.
 * @param {string} filePath
 * @returns {boolean}
 */
function readRequireAuthFromFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const config = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (typeof config.requireAuth === 'boolean') {
        return config.requireAuth;
      }
    }
  } catch (_) {
    // Corrupted config - skip
  }
  return true; // default: auth required
}

/**
 * Save password to a config file (merges with existing keys).
 * @param {string} dir - Config directory path
 * @param {string} filePath - Config file path
 * @param {string} password - Password to save
 */
function savePasswordToFile(dir, filePath, password) {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const config = {};
    try {
      if (fs.existsSync(filePath)) {
        Object.assign(config, JSON.parse(fs.readFileSync(filePath, 'utf-8')));
      }
    } catch (_) {}
    config.password = password;
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (err) {
    // Non-fatal: password still works in memory for this session
  }
}

/**
 * Load or generate the auth password.
 * Priority: env var > ~/.tomnar/config.json > ./state/config.json > auto-generate.
 * When auto-generating, saves to both ~/.tomnar/ and ./state/ so the password
 * persists across npx cache clears and project reinstalls.
 * @returns {string}
 */
function loadPassword() {
  // 1. Environment variable (highest priority, always wins)
  if (process.env.CWM_PASSWORD) {
    return process.env.CWM_PASSWORD;
  }

  // 2. Home directory config (~/.tomnar/config.json) — persists across reinstalls
  const homePassword = readPasswordFromFile(HOME_CONFIG_FILE);
  if (homePassword) {
    // Also sync to local config so it's visible in the project
    savePasswordToFile(LOCAL_CONFIG_DIR, LOCAL_CONFIG_FILE, homePassword);
    return homePassword;
  }

  // 3. Local project config (./state/config.json)
  const localPassword = readPasswordFromFile(LOCAL_CONFIG_FILE);
  if (localPassword) {
    // Promote to home config for persistence across reinstalls
    savePasswordToFile(HOME_CONFIG_DIR, HOME_CONFIG_FILE, localPassword);
    return localPassword;
  }

  // 4. Auto-generate and save to both locations
  const generated = crypto.randomBytes(16).toString('base64url');
  savePasswordToFile(HOME_CONFIG_DIR, HOME_CONFIG_FILE, generated);
  savePasswordToFile(LOCAL_CONFIG_DIR, LOCAL_CONFIG_FILE, generated);

  console.log('');
  console.log('══════════════════════════════════════════════════');
  console.log('  CWM auto-generated password: ' + generated);
  console.log('  Saved to: ~/.tomnar/config.json');
  console.log('  Set CWM_PASSWORD env var to override.');
  console.log('══════════════════════════════════════════════════');
  console.log('');

  return generated;
}

const AUTH_PASSWORD = loadPassword();

/**
 * Load the requireAuth setting.
 * Priority: CWM_NO_AUTH env var > ~/.tomnar/config.json > ./state/config.json > true (default)
 * @returns {boolean}
 */
function loadRequireAuth() {
  if (process.env.CWM_NO_AUTH === '1' || process.env.CWM_NO_AUTH === 'true') {
    return false;
  }
  // Home config takes priority over local — but only if it explicitly sets the key
  try {
    if (fs.existsSync(HOME_CONFIG_FILE)) {
      const config = JSON.parse(fs.readFileSync(HOME_CONFIG_FILE, 'utf-8'));
      if (typeof config.requireAuth === 'boolean') return config.requireAuth;
    }
  } catch (_) {}
  // Fall through to local config
  try {
    if (fs.existsSync(LOCAL_CONFIG_FILE)) {
      const config = JSON.parse(fs.readFileSync(LOCAL_CONFIG_FILE, 'utf-8'));
      if (typeof config.requireAuth === 'boolean') return config.requireAuth;
    }
  } catch (_) {}
  return true; // default: auth required
}

const AUTH_REQUIRED = loadRequireAuth();

// In-memory set of valid tokens. Tokens survive for the lifetime of
// the server process. A restart invalidates all tokens (acceptable
// for a local dev-tool).
const activeTokens = new Set();

// ─── Helpers ───────────────────────────────────────────────

/**
 * Generate a cryptographically random hex token.
 * @returns {string} 64-character hex string
 */
function generateToken() {
  return crypto.randomBytes(TOKEN_BYTE_LENGTH).toString('hex');
}

/**
 * Extract the Bearer token from an Authorization header value.
 * Returns null if the header is missing or malformed.
 * @param {string|undefined} headerValue - The raw Authorization header
 * @returns {string|null}
 */
function extractBearerToken(headerValue) {
  if (!headerValue || typeof headerValue !== 'string') return null;
  const parts = headerValue.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;
  return parts[1];
}

// ─── Middleware ─────────────────────────────────────────────

/**
 * Express middleware that requires a valid Bearer token.
 * Responds with 401 if the token is missing or invalid.
 */
function requireAuth(req, res, next) {
  if (!AUTH_REQUIRED) return next();

  const token = extractBearerToken(req.headers.authorization);
  if (!token || !activeTokens.has(token)) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Valid Bearer token required. POST /api/auth/login to authenticate.',
    });
  }
  req.authToken = token;
  next();
}

// ─── Route Setup ───────────────────────────────────────────

/**
 * Mount authentication routes on the Express app.
 * These routes are NOT protected by requireAuth - they are public.
 *
 * @param {import('express').Express} app - The Express application
 */
function setupAuth(app) {
  /**
   * POST /api/auth/login
   * Body: { password: string }
   * Returns: { success: true, token: string } or { success: false, error: string }
   */
  app.post('/api/auth/login', (req, res) => {
    // Rate limiting
    const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
    if (isRateLimited(clientIp)) {
      return res.status(429).json({
        success: false,
        error: 'Too many login attempts. Try again in 1 minute.',
      });
    }

    const { password } = req.body || {};

    if (!password || typeof password !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Missing or invalid password field in request body.',
      });
    }

    // Constant-time comparison to mitigate timing attacks
    const passwordBuffer = Buffer.from(password, 'utf-8');
    const expectedBuffer = Buffer.from(AUTH_PASSWORD, 'utf-8');
    const isValid =
      passwordBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(passwordBuffer, expectedBuffer);

    if (!isValid) {
      return res.status(403).json({
        success: false,
        error: 'Invalid password.',
      });
    }

    const token = generateToken();
    activeTokens.add(token);

    return res.json({ success: true, token });
  });

  /**
   * POST /api/auth/logout
   * Requires Authorization: Bearer <token>
   * Removes the token from the active set.
   */
  app.post('/api/auth/logout', (req, res) => {
    const token = extractBearerToken(req.headers.authorization);

    if (token) {
      activeTokens.delete(token);
    }

    return res.json({ success: true });
  });

  /**
   * GET /api/auth/check
   * Returns whether the provided Bearer token is still valid.
   */
  app.get('/api/auth/check', (req, res) => {
    const token = extractBearerToken(req.headers.authorization);
    const authenticated = !!token && activeTokens.has(token);

    return res.json({ authenticated });
  });

  /**
   * GET /api/auth/config
   * Public endpoint. Returns whether auth is required.
   * Frontend uses this to decide whether to show the login screen.
   */
  app.get('/api/auth/config', (req, res) => {
    return res.json({ requireAuth: AUTH_REQUIRED });
  });

  /**
   * POST /api/auth/config
   * Protected endpoint. Saves requireAuth setting to ./state/config.json.
   * Body: { requireAuth: boolean }
   */
  app.post('/api/auth/config', requireAuth, (req, res) => {
    const { requireAuth: newVal } = req.body || {};
    if (typeof newVal !== 'boolean') {
      return res.status(400).json({ error: 'requireAuth must be a boolean.' });
    }
    try {
      if (!fs.existsSync(LOCAL_CONFIG_DIR)) {
        fs.mkdirSync(LOCAL_CONFIG_DIR, { recursive: true });
      }
      const config = {};
      try {
        if (fs.existsSync(LOCAL_CONFIG_FILE)) {
          Object.assign(config, JSON.parse(fs.readFileSync(LOCAL_CONFIG_FILE, 'utf-8')));
        }
      } catch (_) {}
      config.requireAuth = newVal;
      fs.writeFileSync(LOCAL_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
    } catch (err) {
      return res.status(500).json({ error: 'Failed to save config.' });
    }
    return res.json({ success: true, requireAuth: newVal });
  });
}

/**
 * Check if a raw token string is valid (exists in activeTokens).
 * Used by SSE endpoint which can't use requireAuth middleware.
 * @param {string} token - The raw token string
 * @returns {boolean}
 */
function isValidToken(token) {
  if (!AUTH_REQUIRED) return true;
  return !!token && activeTokens.has(token);
}

// ─── Exports ───────────────────────────────────────────────

module.exports = {
  setupAuth,
  requireAuth,
  isValidToken,
  isAuthRequired: () => AUTH_REQUIRED,
};
