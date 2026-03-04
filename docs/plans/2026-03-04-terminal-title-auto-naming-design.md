# Design: Terminal Title Auto-Naming

**Date:** 2026-03-04
**Status:** Approved

## Problem

Sessions in the Discovered section are listed by UUID unless a user manually names them or triggers Auto Title. When Claude Code sets its own terminal window title (via OSC 2 sequences), that signal goes unused — xterm.js fires a `onTitleChange` event but nothing listens to it.

## Goal

Automatically assign a session's display name from the terminal title Claude sets, with:
- No overwriting of manually-set names
- A visual distinction in the Discovered section for auto-assigned names

## Data Model

### New store field: `sessionNameSources`

```js
// state shape (store.js)
{
  sessionNames: { [claudeUUID]: string },         // existing — unchanged
  sessionNameSources: { [claudeUUID]: 'auto' | 'manual' }  // new
}
```

Initialized as `{}` alongside `sessionNames`. Missing key = no name assigned yet.

### Updated `setSessionName(uuid, name, source = 'manual')`

- If an entry with `source === 'manual'` already exists, reject auto writes silently
- Writes to both `sessionNames` and `sessionNameSources`

### New store methods

- `getSessionNameSource(uuid)` → `'auto' | 'manual' | null`
- `getAllSessionNameSources()` → full sources map

## API Changes

**`GET /api/session-names`** — extended response (non-breaking, clients check for new field):
```json
{ "names": { "<uuid>": "name" }, "sources": { "<uuid>": "auto" } }
```

**`PUT /api/session-names/:claudeId`** — accepts optional `source` in body (default `'manual'`). Server-side enforces: if existing source is `'manual'`, ignore auto writes.

## Terminal Title Capture (terminal.js)

In `TerminalPane.mount()`, wire the xterm.js title change event:

```js
this.term.onTitleChange((title) => {
  this.onTitleChange?.(title, this.sessionId);
});
```

`onTitleChange` is an opt-in callback set by the app; defaults to undefined (no-op if unset).

## Auto-Assignment Logic (app.js)

In `openTerminalInPane`, after `tp` is created:

```js
tp.onTitleChange = async (title, sessionId) => {
  if (!title || !sessionId) return;
  const source = this.getSessionNameSource(sessionId);
  if (source === 'manual') return;
  await this.syncSessionTitle(sessionId, title, 'auto');
  this.renderProjects();
};
```

`syncSessionTitle` updated to accept and forward a `source` parameter (default `'manual'` to preserve all existing call sites).

`getSessionNameSource(uuid)` is a new app-level helper that checks `this.state.sessionNameSources`.

Client-side state: `this.state.sessionNameSources` loaded alongside `sessionNames` in `loadSessionNames()`.

## Visual Distinction (Discovered section)

In the session item renderer (~line 8354 of app.js), detect auto-assigned names:

```js
const isAuto = this.state.sessionNameSources?.[sessName] === 'auto';
```

Apply CSS class to the name span:
```html
<span class="project-session-name${isAuto ? ' session-name-auto' : ''}">
```

CSS: `session-name-auto` uses `color: var(--subtext0)` — one shade dimmer than default `var(--text)`. No icon, no italic. Subtle enough to signal "auto-assigned" without visual noise.

## What Doesn't Change

- `getProjectSessionTitle()` — unchanged, still returns a plain string
- All existing rename/auto-title call sites — still write `'manual'` by default (source param defaults)
- No data migration — sessions with no source entry are treated as unassigned (`null`)
- The `/clear` scenario is unaffected — existing behaviour already handles UUID resets

## Files Changed

| File | Change |
|------|--------|
| `src/state/store.js` | Add `sessionNameSources` field; update `setSessionName`, add `getSessionNameSource`, `getAllSessionNameSources` |
| `src/web/server.js` | Extend `GET /api/session-names` response; update `PUT` to accept `source` param |
| `src/web/public/terminal.js` | Wire `term.onTitleChange` in `mount()`, expose `onTitleChange` callback |
| `src/web/public/app.js` | Set `tp.onTitleChange` in `openTerminalInPane`; update `syncSessionTitle` signature; add `getSessionNameSource`; update `loadSessionNames`; update Discovered section renderer |
| `src/web/public/app.css` | Add `.session-name-auto` style |
