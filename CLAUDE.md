# Claude Workspace Manager

## CRITICAL SCOPE CONSTRAINT
**You MUST only create, edit, and modify files within this project directory.**

**NEVER modify files outside this folder.** This includes:
- Do NOT edit `~/.claude/settings.json` or any global config
- Do NOT edit files in other projects
- Do NOT modify system files
- All scripts, configs, tests, and output MUST stay within this folder

If you need to READ files outside this folder (e.g., to understand Claude session data), that's fine. But all WRITES stay here.

## Project Goal
Build a lightweight terminal workspace manager for Claude Code sessions that:
1. **Persists session state** - tracks which Claude sessions are running, their IDs, working directories, topics
2. **Auto-recovers after crash/restart** - saves state to disk, auto-reopens sessions on launch
3. **Groups sessions** - organize related sessions into named workspaces
4. **Notifications** - surface agent status, completion, errors
5. **Terminal UI** - clean, fast, minimal. Think tmux-inspired but purpose-built for Claude sessions

## Tech Stack Preferences
- PowerShell or Node.js (must work natively on Windows without WSL)
- State persisted to JSON in this folder
- Leverage Windows Terminal tabs/panes if possible
- Keep dependencies minimal

## Agent Teams
This project has agent teams enabled. Use teammates for:
- One teammate for core state management logic
- One teammate for terminal UI/display
- One teammate for testing and screenshots
- Coordinate via the lead agent

## Testing
- Build tests alongside the code
- Take screenshots of the working UI using Playwright or similar
- Store screenshots in `./screenshots/`

## Feature Session Workflow (NON-NEGOTIABLE)

**Every non-trivial feature MUST be built in a dedicated Claude Code session on its own git branch/worktree.**

### Process

1. **Create a git worktree** for the feature: `git worktree add -b feat/<feature-name> ../cwm-feat-<feature-name>`
2. **Spawn a new Claude Code session** pointed at the worktree directory
3. **Feed it ALL relevant context** — point it at every file and folder it needs:
   - This CLAUDE.md
   - Relevant source files it will read/modify
   - API contracts, data shapes, shared types
   - What the feature should do (requirements)
   - What it should NOT touch (constraints)
4. **Mark the session** in TODO.md or the tomnar's workbook UI with:
   - What the session was created for (feature name)
   - When it was created (ISO timestamp)
   - Status (in-progress / completed / failed)
   - When it finished
5. **Feature session does NOT merge** — it commits to its branch and closes
6. **Orchestrator (main session) merges** — review the branch, resolve conflicts, merge to dev/main
7. **Clean up** — remove the worktree after merge: `git worktree remove ../cwm-feat-<feature-name>`

### Why

- Fresh context per feature = fewer hallucinations and drift
- Isolated branches = safe to experiment, easy to revert
- Orchestrator controls integration = no blind merges
- Audit trail = every feature has a clear lifecycle

### Task Tracking

**ALWAYS use the Todo tool proactively.** Every feature, bug fix, and task should be tracked:
- Create tasks at the start of work (TaskCreate)
- Mark in_progress when starting (TaskUpdate)
- Mark completed when done (TaskUpdate)
- Clean up stale tasks regularly (TaskList → TaskUpdate with deleted status)

## File Structure
```
claude-workspace-manager/
├── CLAUDE.md          # This file
├── src/               # Source code
├── test/              # Tests
├── screenshots/       # UI screenshots
├── state/             # Persisted workspace state (JSON)
└── dist/              # Built output (if applicable)
```
