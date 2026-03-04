# Quota / Usage Widget -- Archived Code Reference

This document archives all quota/usage widget code that was removed from the tomnar's workbook GUI.
It is preserved here so the feature can be re-added later if needed.

The quota widget provided an Anthropic-dashboard-style usage tracker in the sidebar, showing
message counts bucketed by 5-hour session window, daily, weekly, and monthly periods. It included
per-model-tier breakdowns (opus/sonnet/haiku), configurable rate limits, progress bars with
color-coded tiers, a collapsible "Detailed Usage" accordion, and an "API Key In Use" blur overlay.

---

## Table of Contents

1. [Server -- src/web/server.js](#server----srcwebserverjs)
2. [Frontend -- src/web/public/app.js](#frontend----srcwebpublicappjs)
3. [HTML -- src/web/public/index.html](#html----srcwebpublicindexhtml)
4. [CSS -- src/web/public/styles.css](#css----srcwebpublicstylesscss)

---

## Server -- src/web/server.js

Lines 1913-2160. This section contains the cache, helper functions, the JSONL scanner, and the
Express route that serves quota data to the frontend.

### Cache variable and TTL constant

```javascript
/** Cache for aggregated usage stats across all JSONL files */
let _usageQuotaCache = { timestamp: 0, result: null };
const USAGE_QUOTA_CACHE_TTL = 30000; // 30 seconds
```

### classifyModelTier()

```javascript
/**
 * Classify a model ID into a tier: 'opus', 'sonnet', or 'haiku'.
 * Matches Anthropic's dashboard grouping for rate limits.
 * @param {string} model - Model ID (e.g. 'claude-sonnet-4-6', 'claude-opus-4-6')
 * @returns {'opus'|'sonnet'|'haiku'} Model tier
 */
function classifyModelTier(model) {
  if (!model) return 'sonnet'; // default
  const m = model.toLowerCase();
  if (m.includes('opus'))  return 'opus';
  if (m.includes('haiku')) return 'haiku';
  return 'sonnet';
}
```

### nextThursdayAt()

```javascript
/**
 * Calculate the next Thursday at a given hour (Anthropic-style weekly reset).
 * If the current time is past that hour on Thursday, returns next week's Thursday.
 * @param {Date} now - Current date/time
 * @param {number} hour - Hour of reset (0-23)
 * @returns {Date} Next Thursday reset time
 */
function nextThursdayAt(now, hour) {
  const d = new Date(now);
  const day = d.getDay(); // 0=Sun..6=Sat; Thu=4
  let daysUntilThu = (4 - day + 7) % 7;
  if (daysUntilThu === 0 && d.getHours() >= hour) daysUntilThu = 7; // past reset, go to next
  d.setDate(d.getDate() + daysUntilThu);
  d.setHours(hour, 0, 0, 0);
  return d;
}
```

### calculateUsageQuota()

The full ~190-line JSONL scanner that reads all `~/.claude/projects/` session files and
aggregates message counts by time period and model tier.

```javascript
/**
 * Scan all JSONL files and count assistant messages per time period and model tier.
 * Returns message counts bucketed by 5h/daily/weekly/monthly,
 * plus tier breakdowns (all models, sonnet-only) for session and weekly windows.
 * Matches Anthropic's dashboard structure.
 * @returns {object} Usage stats by time period and model tier
 */
function calculateUsageQuota() {
  const now = Date.now();

  // Check cache
  if (_usageQuotaCache.result && (now - _usageQuotaCache.timestamp) < USAGE_QUOTA_CACHE_TTL) {
    return _usageQuotaCache.result;
  }

  const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(claudeProjectsDir)) {
    return { periods: {}, tiers: {}, totalMessages: 0, totalTokens: 0 };
  }

  // Time boundaries
  const nowDate = new Date();
  const fiveHoursAgo = new Date(nowDate.getTime() - 5 * 60 * 60 * 1000);
  const todayStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Sunday start
  const monthStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1);

  // Counters per period
  const buckets = {
    fiveHour: { messages: 0, tokens: 0, cost: 0 },
    daily:    { messages: 0, tokens: 0, cost: 0 },
    weekly:   { messages: 0, tokens: 0, cost: 0 },
    monthly:  { messages: 0, tokens: 0, cost: 0 },
  };

  // Tier counters for Anthropic-style dashboard
  const tierCounts = {
    session:       { all: 0, sonnet: 0, opus: 0, haiku: 0 }, // 5h window
    weekly:        { all: 0, sonnet: 0, opus: 0, haiku: 0 }, // weekly window
  };

  // Model usage breakdown for the 5-hour window
  const modelUsage5h = {};

  try {
    const projectDirs = fs.readdirSync(claudeProjectsDir, { withFileTypes: true })
      .filter(d => d.isDirectory());

    for (const dir of projectDirs) {
      const dirPath = path.join(claudeProjectsDir, dir.name);
      let files;
      try {
        files = fs.readdirSync(dirPath).filter(f => f.endsWith('.jsonl'));
      } catch (_) { continue; }

      for (const file of files) {
        const filePath = path.join(dirPath, file);

        // Skip files not modified in the last 31 days (can't have this-month messages)
        try {
          const stat = fs.statSync(filePath);
          if (stat.mtimeMs < monthStart.getTime()) continue;
        } catch (_) { continue; }

        let content;
        try {
          content = fs.readFileSync(filePath, 'utf-8');
        } catch (_) { continue; }

        const lines = content.split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            if (entry.type !== 'assistant') continue;
            const msg = entry.message;
            if (!msg || !msg.usage) continue;

            const ts = entry.timestamp ? new Date(entry.timestamp) : null;
            if (!ts || isNaN(ts.getTime())) continue;

            const totalTok = (msg.usage.input_tokens || 0) + (msg.usage.output_tokens || 0);
            const model = msg.model || 'unknown';
            const tier = classifyModelTier(model);
            const pricing = TOKEN_PRICING[model] || DEFAULT_PRICING;
            const msgCost =
              ((msg.usage.input_tokens || 0) / 1_000_000) * pricing.input +
              ((msg.usage.output_tokens || 0) / 1_000_000) * pricing.output +
              ((msg.usage.cache_creation_input_tokens || 0) / 1_000_000) * pricing.cacheWrite +
              ((msg.usage.cache_read_input_tokens || 0) / 1_000_000) * pricing.cacheRead;

            // Bucket by time period
            if (ts >= fiveHoursAgo) {
              buckets.fiveHour.messages++;
              buckets.fiveHour.tokens += totalTok;
              buckets.fiveHour.cost += msgCost;
              // Track model usage in 5h window
              if (!modelUsage5h[model]) modelUsage5h[model] = 0;
              modelUsage5h[model]++;
              // Tier counts for session (5h) window
              tierCounts.session.all++;
              tierCounts.session[tier]++;
            }
            if (ts >= todayStart) {
              buckets.daily.messages++;
              buckets.daily.tokens += totalTok;
              buckets.daily.cost += msgCost;
            }
            if (ts >= weekStart) {
              buckets.weekly.messages++;
              buckets.weekly.tokens += totalTok;
              buckets.weekly.cost += msgCost;
              // Tier counts for weekly window
              tierCounts.weekly.all++;
              tierCounts.weekly[tier]++;
            }
            if (ts >= monthStart) {
              buckets.monthly.messages++;
              buckets.monthly.tokens += totalTok;
              buckets.monthly.cost += msgCost;
            }
          } catch (_) {
            // Skip malformed lines
          }
        }
      }
    }
  } catch (_) {
    // If projects dir can't be read, return empty
  }

  // Calculate reset times
  const fiveHourReset = new Date(nowDate.getTime() + (5 * 60 * 60 * 1000 - (nowDate.getTime() - fiveHoursAgo.getTime())));
  const tomorrow = new Date(todayStart);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const nextWeek = new Date(weekStart);
  nextWeek.setDate(nextWeek.getDate() + 7);
  const nextMonth = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 1);

  // Anthropic-style weekly reset times (Thursday)
  const weeklyAllReset = nextThursdayAt(nowDate, 17);   // Thu 5:00 PM
  const weeklySonnetReset = nextThursdayAt(nowDate, 23); // Thu 11:00 PM

  // Round costs
  for (const b of Object.values(buckets)) {
    b.cost = Math.round(b.cost * 1000) / 1000;
  }

  const result = {
    periods: {
      fiveHour: {
        ...buckets.fiveHour,
        label: '5-Hour Window',
        resetAt: fiveHourReset.toISOString(),
        windowMs: 5 * 60 * 60 * 1000,
      },
      daily: {
        ...buckets.daily,
        label: 'Today',
        resetAt: tomorrow.toISOString(),
      },
      weekly: {
        ...buckets.weekly,
        label: 'This Week',
        resetAt: nextWeek.toISOString(),
      },
      monthly: {
        ...buckets.monthly,
        label: 'This Month',
        resetAt: nextMonth.toISOString(),
      },
    },
    // Anthropic-style tier breakdown
    tiers: {
      session: {
        ...tierCounts.session,
        resetAt: fiveHourReset.toISOString(),
      },
      weeklyAll: {
        count: tierCounts.weekly.all,
        resetAt: weeklyAllReset.toISOString(),
      },
      weeklySonnet: {
        count: tierCounts.weekly.sonnet,
        resetAt: weeklySonnetReset.toISOString(),
      },
    },
    modelUsage5h,
    serverTime: nowDate.toISOString(),
  };

  _usageQuotaCache = { timestamp: now, result };
  return result;
}
```

### GET /api/usage/quota Express route

```javascript
/**
 * GET /api/usage/quota
 * Returns message counts and token usage bucketed by time period (5h, daily, weekly, monthly).
 * Scans all JSONL files under ~/.claude/projects/. Cached for 30 seconds.
 */
app.get('/api/usage/quota', requireAuth, (req, res) => {
  try {
    const data = calculateUsageQuota();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to calculate usage quota: ' + err.message });
  }
});
```

### API Response Shape

The `/api/usage/quota` endpoint returns this structure:

```json
{
  "periods": {
    "fiveHour": { "messages": 42, "tokens": 180000, "cost": 1.234, "label": "5-Hour Window", "resetAt": "2026-02-20T15:00:00.000Z", "windowMs": 18000000 },
    "daily":    { "messages": 120, "tokens": 500000, "cost": 3.456, "label": "Today", "resetAt": "2026-02-21T00:00:00.000Z" },
    "weekly":   { "messages": 450, "tokens": 2000000, "cost": 12.789, "label": "This Week", "resetAt": "2026-02-23T00:00:00.000Z" },
    "monthly":  { "messages": 1200, "tokens": 5000000, "cost": 34.567, "label": "This Month", "resetAt": "2026-03-01T00:00:00.000Z" }
  },
  "tiers": {
    "session":       { "all": 42, "sonnet": 30, "opus": 10, "haiku": 2, "resetAt": "..." },
    "weeklyAll":     { "count": 450, "resetAt": "..." },
    "weeklySonnet":  { "count": 300, "resetAt": "..." }
  },
  "modelUsage5h": { "claude-sonnet-4-6": 30, "claude-opus-4-6": 10, "claude-haiku-3-5": 2 },
  "serverTime": "2026-02-20T10:00:00.000Z"
}
```

### Dependencies

The `calculateUsageQuota()` function references these variables defined elsewhere in server.js:

- `TOKEN_PRICING` -- object mapping model IDs to `{ input, output, cacheWrite, cacheRead }` per-million-token rates
- `DEFAULT_PRICING` -- fallback pricing used when a model ID is not found in `TOKEN_PRICING`
- `path`, `fs`, `os` -- Node.js built-in modules (already imported at the top of server.js)

---

## Frontend -- src/web/public/app.js

### Settings defaults (lines 125-133)

These keys are in the `this.state.settings` defaults object inside the `CWMApp` constructor:

```javascript
quotaWidgetVisible: true,
quotaApiKeyMode: false,
quotaSessionLimit: 0,
quotaWeeklyAllLimit: 0,
quotaWeeklySonnetLimit: 0,
quotaDailyLimit: 0,
quotaWeeklyLimit: 0,
quotaMonthlyLimit: 0,
quotaFiveHourLimit: 0,
```

### DOM element caching (lines 408-414)

Inside the `this.els` object in the constructor:

```javascript
// Quota Widget
quotaWidget: document.getElementById('quota-widget'),
quotaPrimary: document.getElementById('quota-primary'),
quotaDetailsToggle: document.getElementById('quota-details-toggle'),
quotaDetailsBody: document.getElementById('quota-details-body'),
quotaBars: document.getElementById('quota-bars'),
quotaApikeyOverlay: document.getElementById('quota-apikey-overlay'),
```

### Settings registry entries (Usage category, lines 2532-2536)

These entries are in the array returned by `getSettingsRegistry()`:

```javascript
{ key: 'quotaWidgetVisible', label: 'Usage Quota Widget', description: 'Show plan usage tracker in the sidebar', category: 'Usage' },
{ key: 'quotaApiKeyMode', label: 'API Key Mode', description: 'Blur the quota widget and show "API Key In Use" overlay', category: 'Usage' },
{ key: 'quotaSessionLimit', label: 'Session Limit (5h)', description: 'Max messages per 5-hour session window (0 = no limit shown)', category: 'Usage', type: 'number' },
{ key: 'quotaWeeklyAllLimit', label: 'Weekly All Models Limit', description: 'Weekly rate limit for all models combined (0 = no limit shown)', category: 'Usage', type: 'number' },
{ key: 'quotaWeeklySonnetLimit', label: 'Weekly Sonnet Limit', description: 'Weekly rate limit for Sonnet-only usage (0 = no limit shown)', category: 'Usage', type: 'number' },
```

### Event listener for quota details toggle (lines 598-601)

In the event binding section of the constructor:

```javascript
// Quota widget details accordion
if (this.els.quotaDetailsToggle) {
  this.els.quotaDetailsToggle.addEventListener('click', () => this.toggleQuotaDetails());
}
```

### Quota polling startup call (line 1193)

In the `init()` method, after `applySettings()`:

```javascript
// Start quota usage polling (non-blocking, 60s interval)
this.startQuotaPolling();
```

### Number input re-render hook (lines 3061-3071)

In the settings body, number input change events trigger a quota re-render:

```javascript
// Bind number input change events (for quota limits)
this.els.settingsBody.querySelectorAll('input[data-setting-num]').forEach(input => {
  input.addEventListener('change', (e) => {
    const key = e.target.dataset.settingNum;
    this.state.settings[key] = parseInt(e.target.value, 10) || 0;
    this.saveSettings();
    this.applySettings();
    // Re-render quota widget with new limits
    if (this._lastQuotaData) this.renderQuotaWidget(this._lastQuotaData);
  });
});
```

### applySettings() call to applyQuotaSettings (line 3102)

At the end of the `applySettings()` method:

```javascript
// Quota widget visibility and API key mode
this.applyQuotaSettings();
```

### Quota widget methods (lines 3106-3332)

The full block of quota-related methods on the `CWMApp` class:

```javascript
/* ═══════════════════════════════════════════════════════════
   QUOTA USAGE WIDGET
   ═══════════════════════════════════════════════════════════ */

/** Apply quota-specific settings (visibility, API key blur) */
applyQuotaSettings() {
  if (!this.els.quotaWidget) return;
  this.els.quotaWidget.style.display = this.state.settings.quotaWidgetVisible ? '' : 'none';
  if (this.els.quotaApikeyOverlay) {
    this.els.quotaApikeyOverlay.hidden = !this.state.settings.quotaApiKeyMode;
  }
}

/** Toggle the "Detailed Usage" accordion open/closed */
toggleQuotaDetails() {
  if (!this.els.quotaDetailsToggle || !this.els.quotaDetailsBody) return;
  const isOpen = !this.els.quotaDetailsBody.hidden;
  this.els.quotaDetailsBody.hidden = isOpen;
  this.els.quotaDetailsToggle.classList.toggle('open', !isOpen);
  localStorage.setItem('cwm_quotaDetailsOpen', isOpen ? '0' : '1');
}

/** Start periodic polling for usage quota (every 60s) */
startQuotaPolling() {
  if (!this.els.quotaPrimary) return;

  // Restore details accordion state
  if (localStorage.getItem('cwm_quotaDetailsOpen') === '1' && this.els.quotaDetailsToggle) {
    this.els.quotaDetailsBody.hidden = false;
    this.els.quotaDetailsToggle.classList.add('open');
  }

  // Initial fetch
  this.fetchAndRenderQuota();

  // Poll every 60 seconds
  this._quotaInterval = setInterval(() => this.fetchAndRenderQuota(), 60000);
}

/** Fetch usage quota from server and render the widget */
async fetchAndRenderQuota() {
  if (!this.els.quotaPrimary) return;
  try {
    const data = await this.api('GET', '/api/usage/quota');
    this._lastQuotaData = data;
    this.renderQuotaWidget(data);
  } catch (_) {
    // Silently fail — don't disrupt the UX for a non-critical widget
  }
}

/**
 * Format a millisecond duration into a human-readable reset countdown.
 * Matches Anthropic dashboard format: "Resets in 2 hr 32 min", "Resets Thu 5:00 PM"
 * @param {string} resetAt - ISO timestamp of reset
 * @param {boolean} [absolute] - Show absolute day/time instead of countdown
 * @returns {string} Formatted reset text
 */
_formatResetText(resetAt, absolute) {
  if (!resetAt) return '';
  const diffMs = new Date(resetAt).getTime() - Date.now();
  if (diffMs <= 0) return 'Resetting...';

  if (absolute) {
    const d = new Date(resetAt);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const hr = d.getHours();
    const ampm = hr >= 12 ? 'PM' : 'AM';
    const h12 = hr % 12 || 12;
    const min = d.getMinutes().toString().padStart(2, '0');
    return `Resets ${days[d.getDay()]} ${h12}:${min} ${ampm}`;
  }

  const hrs = Math.floor(diffMs / 3600000);
  const mins = Math.floor((diffMs % 3600000) / 60000);
  if (hrs > 0) return `Resets in ${hrs} hr ${mins} min`;
  return `Resets in ${mins} min`;
}

/**
 * Get a CSS tier class based on usage percentage.
 * @param {number} pct - Usage percentage (0-100)
 * @param {boolean} hasLimit - Whether a limit is configured
 * @returns {string} tier class name
 */
_usageTier(pct, hasLimit) {
  if (!hasLimit) return 'nomax';
  if (pct >= 90) return 'crit';
  if (pct >= 70) return 'high';
  if (pct >= 40) return 'mid';
  return 'low';
}

/**
 * Render the quota usage widget from API data.
 * Matches Anthropic's dashboard: "Current session" + "Weekly limits" sections.
 * Detailed per-period breakdown in collapsible accordion below.
 * @param {object} data - Response from /api/usage/quota
 */
renderQuotaWidget(data) {
  if (!this.els.quotaPrimary || !data || !data.periods) return;

  const settings = this.state.settings;
  const tiers = data.tiers || {};

  // ── Anthropic-style: Current session + Weekly limits ──
  let primaryHtml = '';

  // ─ Current session (5h rolling window) ─
  const sessionData = tiers.session || {};
  const sessionCount = sessionData.all || 0;
  const sessionLimit = settings.quotaSessionLimit || 0;
  const sessionPct = sessionLimit > 0 ? Math.min((sessionCount / sessionLimit) * 100, 100) : 0;
  const sessionTier = this._usageTier(sessionPct, sessionLimit > 0);
  const sessionWidthPct = sessionLimit > 0 ? sessionPct : Math.min(sessionCount, 100);
  const sessionResetText = this._formatResetText(sessionData.resetAt);

  primaryHtml += `
    <div class="quota-section">
      <div class="quota-section-header">
        <span class="quota-section-title">Current session</span>
      </div>
      <div class="quota-row">
        <div class="quota-row-meta">
          <span class="quota-row-reset">${sessionResetText}</span>
          <span class="quota-row-pct">${sessionLimit > 0 ? Math.round(sessionPct) + '% used' : sessionCount + ' msgs'}</span>
        </div>
        <div class="quota-primary-track">
          <div class="quota-primary-fill tier-${sessionTier}" style="width:${sessionWidthPct}%"></div>
        </div>
      </div>
    </div>`;

  // ─ Weekly limits ─
  const weeklyAll = tiers.weeklyAll || {};
  const weeklySonnet = tiers.weeklySonnet || {};
  const weeklyAllCount = weeklyAll.count || 0;
  const weeklySonnetCount = weeklySonnet.count || 0;
  const weeklyAllLimit = settings.quotaWeeklyAllLimit || 0;
  const weeklySonnetLimit = settings.quotaWeeklySonnetLimit || 0;

  const weeklyAllPct = weeklyAllLimit > 0 ? Math.min((weeklyAllCount / weeklyAllLimit) * 100, 100) : 0;
  const weeklySonnetPct = weeklySonnetLimit > 0 ? Math.min((weeklySonnetCount / weeklySonnetLimit) * 100, 100) : 0;
  const weeklyAllTier = this._usageTier(weeklyAllPct, weeklyAllLimit > 0);
  const weeklySonnetTier = this._usageTier(weeklySonnetPct, weeklySonnetLimit > 0);
  const weeklyAllWidthPct = weeklyAllLimit > 0 ? weeklyAllPct : Math.min(weeklyAllCount, 100);
  const weeklySonnetWidthPct = weeklySonnetLimit > 0 ? weeklySonnetPct : Math.min(weeklySonnetCount, 100);

  primaryHtml += `
    <div class="quota-section quota-section-weekly">
      <div class="quota-section-header">
        <span class="quota-section-title">Weekly limits</span>
      </div>
      <div class="quota-row">
        <div class="quota-row-label">All models</div>
        <div class="quota-row-meta">
          <span class="quota-row-reset">${this._formatResetText(weeklyAll.resetAt, true)}</span>
          <span class="quota-row-pct">${weeklyAllLimit > 0 ? Math.round(weeklyAllPct) + '% used' : weeklyAllCount + ' msgs'}</span>
        </div>
        <div class="quota-primary-track">
          <div class="quota-primary-fill tier-${weeklyAllTier}" style="width:${weeklyAllWidthPct}%"></div>
        </div>
      </div>
      <div class="quota-row">
        <div class="quota-row-label">Sonnet only</div>
        <div class="quota-row-meta">
          <span class="quota-row-reset">${this._formatResetText(weeklySonnet.resetAt, true)}</span>
          <span class="quota-row-pct">${weeklySonnetLimit > 0 ? Math.round(weeklySonnetPct) + '% used' : weeklySonnetCount + ' msgs'}</span>
        </div>
        <div class="quota-primary-track">
          <div class="quota-primary-fill tier-${weeklySonnetTier}" style="width:${weeklySonnetWidthPct}%"></div>
        </div>
      </div>
    </div>`;

  this.els.quotaPrimary.innerHTML = primaryHtml;

  // ── Detail bars: all 4 periods + cost in the accordion ──
  if (this.els.quotaBars) {
    const periodKeys = ['fiveHour', 'daily', 'weekly', 'monthly'];
    const periodLimits = {
      fiveHour: settings.quotaFiveHourLimit || 0,
      daily:    settings.quotaDailyLimit || 0,
      weekly:   settings.quotaWeeklyLimit || 0,
      monthly:  settings.quotaMonthlyLimit || 0,
    };
    let detailHtml = '';

    for (const key of periodKeys) {
      const p = data.periods[key];
      if (!p) continue;

      const limit = periodLimits[key];
      const msgs = p.messages;
      const pct = limit > 0 ? Math.min((msgs / limit) * 100, 100) : 0;
      const tier = this._usageTier(pct, limit > 0);
      const widthPct = limit > 0 ? pct : Math.min(msgs * 2, 100);

      const valueText = limit > 0
        ? `${msgs.toLocaleString()} / ${limit.toLocaleString()}`
        : `${msgs.toLocaleString()} msgs`;

      const costText = p.cost > 0 ? ` · $${p.cost.toFixed(2)}` : '';

      detailHtml += `
        <div class="quota-bar-row">
          <div class="quota-bar-label">
            <span class="quota-bar-name">${p.label}</span>
            <span class="quota-bar-value">${valueText}${costText}</span>
          </div>
          <div class="quota-bar-track">
            <div class="quota-bar-fill tier-${tier}" style="width:${widthPct}%"></div>
          </div>
        </div>`;
    }

    this.els.quotaBars.innerHTML = detailHtml;
  }
}

/** Clean up quota polling interval */
stopQuotaPolling() {
  if (this._quotaInterval) {
    clearInterval(this._quotaInterval);
    this._quotaInterval = null;
  }
}
```

### Instance properties used by quota

- `this._lastQuotaData` -- cached response from the last successful `/api/usage/quota` fetch
- `this._quotaInterval` -- the `setInterval` ID for the 60-second polling loop

### localStorage keys used by quota

- `cwm_quotaDetailsOpen` -- `'0'` or `'1'`, persists whether the "Detailed Usage" accordion is expanded
- `cwm_settings` -- the full settings object (contains all `quota*` keys listed above)

---

## HTML -- src/web/public/index.html

Lines 314-334. This block sits at the bottom of the `.sidebar` section, between `#projects-list` and the sidebar collapse button.

```html
<!-- Usage Quota Widget -->
<div class="quota-widget" id="quota-widget">
  <!-- Primary usage bar (always visible) -->
  <div class="quota-primary" id="quota-primary">
    <!-- Rendered by app.js: single bar + reset timer -->
  </div>
  <!-- Collapsible detailed usage -->
  <button class="quota-details-toggle" id="quota-details-toggle">
    <svg class="quota-details-chevron" width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 6l3.5 4 3.5-4z"/></svg>
    <span>Detailed Usage</span>
  </button>
  <div class="quota-details-body" id="quota-details-body" hidden>
    <div class="quota-bars" id="quota-bars">
      <!-- Rendered by app.js: 4 period bars -->
    </div>
  </div>
  <!-- API key blur overlay -->
  <div class="quota-apikey-overlay" id="quota-apikey-overlay" hidden>
    <span class="quota-apikey-label">API Key In Use</span>
  </div>
</div>
```

---

## CSS -- src/web/public/styles.css

### Main quota styles (lines 790-1041)

```css
/* ─── Quota Usage Widget ─────────────────────────────────── */
.quota-widget {
  position: relative;
  padding: 10px 14px 8px;
  border-top: 1px solid var(--border-subtle);
  flex-shrink: 0;
  overflow: hidden;
}

/* ── Primary usage area (Anthropic dashboard-style sections) ── */
.quota-primary {
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* Section container (Current session / Weekly limits) */
.quota-section {
  padding-bottom: 8px;
}

.quota-section-weekly {
  padding-top: 6px;
  border-top: 1px solid var(--surface0);
}

.quota-section-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 6px;
}

.quota-section-title {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--overlay0);
}

/* Individual quota row (bar + metadata) */
.quota-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-bottom: 6px;
}

.quota-row:last-child {
  margin-bottom: 0;
}

.quota-row-label {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-secondary);
}

.quota-row-meta {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 10px;
  color: var(--overlay0);
  font-variant-numeric: tabular-nums;
}

.quota-row-reset {
  color: var(--text-muted);
}

.quota-row-pct {
  color: var(--overlay0);
}

/* Progress bar track + fill (shared by all bars) */
.quota-primary-track {
  height: 6px;
  background: var(--surface0);
  border-radius: 3px;
  overflow: hidden;
  position: relative;
}

.quota-primary-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.3s ease;
  min-width: 0;
}

/* Color tiers based on usage percentage */
.quota-primary-fill.tier-low    { background: var(--green); }
.quota-primary-fill.tier-mid    { background: var(--yellow); }
.quota-primary-fill.tier-high   { background: var(--peach); }
.quota-primary-fill.tier-crit   { background: var(--red); }
.quota-primary-fill.tier-nomax  { background: var(--blue); opacity: 0.6; }

/* Pulse when critical */
.quota-primary-fill.tier-crit {
  animation: quota-pulse 2s ease-in-out infinite;
}

@keyframes quota-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

/* ── Detailed Usage accordion ── */
.quota-details-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 6px 0 2px;
  margin-top: 2px;
  background: transparent !important;
  background-color: transparent !important;
  border: none;
  outline: none;
  color: var(--overlay0);
  font-size: 10px;
  font-family: inherit;
  cursor: pointer;
  transition: color var(--transition-fast);
  -webkit-appearance: none;
  appearance: none;
}

.quota-details-toggle:hover,
.quota-details-toggle:focus,
.quota-details-toggle:active {
  color: var(--text-secondary);
  background: transparent !important;
  background-color: transparent !important;
}

.quota-details-chevron {
  transition: transform 0.15s ease;
  flex-shrink: 0;
}

.quota-details-toggle.open .quota-details-chevron {
  transform: rotate(0deg);
}

.quota-details-toggle:not(.open) .quota-details-chevron {
  transform: rotate(-90deg);
}

.quota-details-body {
  overflow: hidden;
  transition: max-height 0.2s ease, opacity 0.15s ease;
}

.quota-details-body[hidden] {
  display: block;
  max-height: 0;
  opacity: 0;
  pointer-events: none;
}

.quota-details-body:not([hidden]) {
  max-height: 300px;
  opacity: 1;
}

.quota-bars {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 4px;
}

/* Individual quota bar row */
.quota-bar-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.quota-bar-label {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 11px;
  line-height: 1;
}

.quota-bar-name {
  color: var(--text-secondary);
  font-weight: 500;
}

.quota-bar-value {
  color: var(--text-muted);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

/* Detail bar tracks (thinner than primary) */
.quota-bar-track {
  height: 3px;
  background: var(--surface0);
  border-radius: 2px;
  overflow: hidden;
  position: relative;
}

.quota-bar-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.3s ease;
  min-width: 0;
}

.quota-bar-fill.tier-low    { background: var(--green); }
.quota-bar-fill.tier-mid    { background: var(--yellow); }
.quota-bar-fill.tier-high   { background: var(--peach); }
.quota-bar-fill.tier-crit   { background: var(--red); }
.quota-bar-fill.tier-nomax  { background: var(--blue); opacity: 0.6; }

/* API key blur overlay */
.quota-apikey-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  background: color-mix(in srgb, var(--bg-primary) 60%, transparent);
  border-radius: inherit;
  z-index: 2;
}

.quota-apikey-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  padding: 4px 10px;
  border: 1px solid var(--surface1);
  border-radius: var(--radius-sm);
  background: var(--surface0);
  letter-spacing: 0.03em;
}

/* Hide widget when sidebar is collapsed */
.sidebar.collapsed .quota-widget {
  display: none;
}
```

### Mobile responsive rule (line 2914)

Inside the `@media (max-width: 768px)` block (starting at line 2786):

```css
.quota-widget { display: none; }
```

---

## Re-integration Checklist

To re-add this feature, you would need to:

1. **server.js**: Paste the cache variable, `classifyModelTier()`, `nextThursdayAt()`, `calculateUsageQuota()`, and the `/api/usage/quota` route back into the server. Ensure `TOKEN_PRICING` and `DEFAULT_PRICING` are still defined (they are used by cost tracking elsewhere and should still be present).

2. **app.js -- constructor settings**: Add all nine `quota*` keys back to the settings defaults object.

3. **app.js -- constructor DOM caching**: Add the six `quota*` element references back to `this.els`.

4. **app.js -- event listeners**: Re-add the `quotaDetailsToggle` click listener.

5. **app.js -- init()**: Re-add the `this.startQuotaPolling()` call after `this.applySettings()`.

6. **app.js -- settings registry**: Add the five Usage-category entries back to `getSettingsRegistry()`.

7. **app.js -- number input handler**: Ensure the settings body re-renders quota on number input changes.

8. **app.js -- applySettings()**: Re-add the `this.applyQuotaSettings()` call at the end.

9. **app.js -- methods**: Paste back all eight quota methods (`applyQuotaSettings`, `toggleQuotaDetails`, `startQuotaPolling`, `fetchAndRenderQuota`, `_formatResetText`, `_usageTier`, `renderQuotaWidget`, `stopQuotaPolling`).

10. **index.html**: Insert the quota widget HTML block in the sidebar, between `#projects-list` and `.sidebar-collapse-bar`.

11. **styles.css**: Paste back the main quota CSS block and the mobile `display: none` rule.
