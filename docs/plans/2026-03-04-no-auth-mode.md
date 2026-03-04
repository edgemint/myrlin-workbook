# No-Auth Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `requireAuth: false` config flag that disables the login screen entirely so the app opens directly without a password.

**Architecture:** A new `GET /api/auth/config` public endpoint exposes whether auth is required. The backend's `requireAuth` middleware and `isValidToken` become no-ops when disabled. The frontend checks this endpoint on startup and skips the login screen when auth is off.

**Tech Stack:** Node.js/Express (backend), vanilla JS (frontend), `state/config.json` + `~/.tomnar/config.json` (config)

---

### Task 1: Read `requireAuth` flag in `auth.js`

**Files:**
- Modify: `src/web/auth.js`

**Step 1: Add `readRequireAuthFromFile` helper after `readPasswordFromFile`**

Insert after line 90 (after the closing `}` of `readPasswordFromFile`):

```js
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
  } catch (_) {}
  return true; // default: auth required
}
```

**Step 2: Add `loadRequireAuth` function after `loadPassword`**

Insert after `const AUTH_PASSWORD = loadPassword();` (around line 161):

```js
/**
 * Load the requireAuth setting.
 * Priority: CWM_NO_AUTH env var > ~/.tomnar/config.json > ./state/config.json > true (default)
 * @returns {boolean}
 */
function loadRequireAuth() {
  if (process.env.CWM_NO_AUTH === '1' || process.env.CWM_NO_AUTH === 'true') {
    return false;
  }
  // Home config takes priority over local
  if (fs.existsSync(HOME_CONFIG_FILE)) {
    const val = readRequireAuthFromFile(HOME_CONFIG_FILE);
    if (!val) return false; // explicitly disabled
  }
  return readRequireAuthFromFile(LOCAL_CONFIG_FILE);
}

const AUTH_REQUIRED = loadRequireAuth();
```

**Step 3: Update `requireAuth` middleware to be a no-op when disabled**

Replace the existing `requireAuth` function body with:

```js
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
```

**Step 4: Update `isValidToken` to always return true when auth disabled**

Replace the body of `isValidToken`:

```js
function isValidToken(token) {
  if (!AUTH_REQUIRED) return true;
  return !!token && activeTokens.has(token);
}
```

**Step 5: Export `AUTH_REQUIRED` and add `isAuthRequired` helper**

Add to the `module.exports` block:

```js
module.exports = {
  setupAuth,
  requireAuth,
  isValidToken,
  isAuthRequired: () => AUTH_REQUIRED,
};
```

**Step 6: Commit**

```bash
git add src/web/auth.js
git commit -m "feat(auth): add no-auth mode via requireAuth config flag"
```

---

### Task 2: Expose `GET /api/auth/config` public endpoint

**Files:**
- Modify: `src/web/auth.js` (inside `setupAuth`)
- Modify: `src/web/server.js` (import update)

**Step 1: Add the endpoint inside `setupAuth`, before the closing `}`**

At the end of `setupAuth`, before the final `}`:

```js
  /**
   * GET /api/auth/config
   * Public endpoint. Returns whether auth is required.
   * Frontend uses this to decide whether to show the login screen.
   */
  app.get('/api/auth/config', (req, res) => {
    return res.json({ requireAuth: AUTH_REQUIRED });
  });
```

**Step 2: Commit**

```bash
git add src/web/auth.js
git commit -m "feat(auth): expose GET /api/auth/config for frontend auth discovery"
```

---

### Task 3: Frontend skips login when auth is disabled

**Files:**
- Modify: `src/web/public/app.js`

The frontend `init()` method currently lives around line 1845–1876. It checks `this.state.token`, calls `checkAuth()`, and routes to `showLogin()` or `showApp()`.

**Step 1: Add `fetchAuthConfig` method**

Add this method near `checkAuth` (around line 1929):

```js
  async fetchAuthConfig() {
    try {
      const data = await fetch('/api/auth/config').then(r => r.json());
      return data.requireAuth !== false; // treat missing as true
    } catch {
      return true; // default to requiring auth on network error
    }
  }
```

**Step 2: Update `init()` to call `fetchAuthConfig` first**

Replace the auth-routing block in `init()` (approximately lines 1853–1875):

```js
    const authRequired = await this.fetchAuthConfig();
    this.state.authRequired = authRequired;

    if (!authRequired) {
      this.showApp();
      this.initDragAndDrop();
      this.initTerminalResize();
      this.initTerminalGroups();
      await this.loadInitialData();
      this.connectSSE();
      return;
    }

    if (this.state.token) {
      const valid = await this.checkAuth();
      if (valid) {
        this.showApp();
        this.initDragAndDrop();
        this.initTerminalResize();
        this.initTerminalGroups();
        await this.loadInitialData();
        this.connectSSE();
      } else {
        this.state.token = null;
        localStorage.removeItem('cwm_token');
        this.showLogin();
      }
    } else {
      this.showLogin();
    }
```

**Step 3: Prevent 401 redirects to login when auth is disabled**

In the `api()` method (around line 1896–1900), the 401 handler calls `showLogin()`. Wrap it:

```js
      if (res.status === 401) {
        if (this.state.authRequired !== false) {
          this.state.token = null;
          localStorage.removeItem('cwm_token');
          this.showLogin();
          this.disconnectSSE();
        }
        const apiErr = new Error('Unauthorized');
        apiErr.status = res.status;
        throw apiErr;
      }
```

**Step 4: Commit**

```bash
git add src/web/public/app.js
git commit -m "feat(app): skip login screen when auth is disabled"
```

---

### Task 4: Set the flag in config to test it

**Step 1: Add `requireAuth: false` to `state/config.json`**

Edit `state/config.json`:
```json
{
  "password": "<existing-value>",
  "requireAuth": false
}
```

**Step 2: Restart the server and verify the app opens without login**

Run: `node src/index.js` (or however you normally start the server)

Expected: Browser navigates straight to the session list — no login screen appears.

**Step 3: Re-enable auth and verify login screen returns**

Set `requireAuth` back to `true` in `state/config.json`, restart, and confirm the login screen is shown again.

**Step 4: Revert `state/config.json` to default (auth on)**

Leave `state/config.json` with `requireAuth` absent or `true` — no-auth is opt-in.

**Step 5: Commit**

```bash
git add state/config.json
git commit -m "chore: restore requireAuth default after manual testing"
```

---

### Task 5: Document the setting

**Files:**
- Modify: `README.md` (if it exists) or create a note in `docs/`

**Step 1: Add a short note about the `requireAuth` setting**

In the auth/configuration section of the README (or wherever passwords are documented), add:

```markdown
### Disabling the Login Screen

Set `requireAuth: false` in `state/config.json` (or `~/.tomnar/config.json`) to skip authentication entirely:

```json
{ "requireAuth": false }
```

Alternatively, set the `CWM_NO_AUTH=1` environment variable.

> **Warning:** Only disable auth when the server is not exposed to untrusted networks.
```

**Step 2: Commit**

```bash
git add README.md   # or whichever file you edited
git commit -m "docs: document requireAuth/CWM_NO_AUTH no-auth mode"
```
