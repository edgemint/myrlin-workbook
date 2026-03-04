# tomnar's workbook - Workflows Guide

A practical guide to using tomnar's workbook's features, from basic workspace management to advanced autonomous task workflows.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Workspaces & Sessions](#workspaces--sessions)
3. [Terminal Panes](#terminal-panes)
4. [Worktree Tasks](#worktree-tasks)
5. [Auto-Trust & Question Detection](#auto-trust--question-detection)
6. [Diff Viewer & Code Review](#diff-viewer--code-review)
7. [Templates](#templates)
8. [Cost Tracking](#cost-tracking)
9. [Search & Navigation](#search--navigation)
10. [Settings](#settings)
11. [Keyboard Shortcuts](#keyboard-shortcuts)

---

## Getting Started

### Installation

```bash
npx tomnar-workbook
```

This starts the GUI server on `http://localhost:3456` and opens your browser.

### First Run

1. Set a password when prompted (stored locally, used for auth)
2. Create your first workspace: click **+ New Workspace** in the sidebar
3. Add sessions to track your Claude Code instances

---

## Workspaces & Sessions

### Creating a Workspace

Click the **+** button in the sidebar header, or press **Ctrl+N**.

Workspaces group related sessions together. For example:
- **my-app** workspace with sessions for frontend, backend, and tests
- **research** workspace with exploration sessions

### Adding Sessions

Right-click a workspace or use the workspace's context menu to add sessions. Sessions can be:
- **Manual**: You name them and track their status yourself
- **Discovered**: Import existing Claude Code sessions from your system (Settings > Discover Sessions)

### Session Detail

Click any session in the sidebar to see its detail panel:
- Status, workspace, working directory, branch
- Cost breakdown (if cost tracking is enabled)
- Changed files (for worktree task sessions)

---

## Terminal Panes

The main content area supports up to 4 terminal panes in a grid layout.

### Opening Terminals

- **Double-click** a session in the sidebar
- **Drag and drop** a session onto an empty grid slot
- **Right-click** a session and select "Open in Terminal"

### Terminal Features

- **Activity indicators**: Colored dot on pane header shows if session is actively producing output
- **Idle detection**: Detects when Claude finishes working (configurable threshold)
- **Completion notifications**: Desktop notification when a session goes idle
- **Pane color highlights**: Each pane slot gets a distinct colored border (mauve, blue, green, peach) with matching pips in the sidebar

### Pane Management

- Click tab strip at the top to focus a pane
- Right-click pane header for context menu (close, inspect, etc.)
- Drag sessions between panes to rearrange

---

## Worktree Tasks

> **What it is**: An autonomous task system that creates isolated git branches (worktrees) for each task, runs Claude Code sessions on them, and provides a review/merge workflow.

### Enabling

Go to **Settings** (gear icon or **Ctrl+,**) and enable **Worktree Tasks** under the Advanced category.

### Creating a Task

**Method 1: Workspace hover button**
1. Hover over a workspace in the sidebar
2. Click the **+** button that appears
3. Fill in the New Task dialog

**Method 2: Tasks view**
1. Switch to the **Tasks** view in the sidebar (checkbox icon tab)
2. Click **New Task**

**Method 3: Keyboard shortcut**
- Press **Ctrl+Shift+N** to open the New Task dialog

### New Task Dialog

| Field | Description |
|-------|-------------|
| **Task Name** | What the agent should work on. Becomes the branch name (`feat/your-task-name`) |
| **Project Directory** | Auto-detected from your sessions' working directories. Pick from dropdown or enter a custom path |
| **Initial Prompt** | (Optional) The prompt to feed the Claude session when it starts |
| **Model** | Default, Opus, Sonnet, or Haiku |
| **Flags** | Skip Permissions, Verbose |

### Task Lifecycle

```
Create  -->  Running  -->  Review  -->  Merged
  |             |             |           |
  |             |             +-> Reject  |
  |             |                         |
  |             +-> Resume (if paused) <--+
  |
  +-> The task creates:
       - A new git branch (feat/your-task-name)
       - A git worktree in <project>-wt/feat-your-task-name/
       - A session pointing at the worktree directory
```

### Tasks View

Switch to the **Tasks** tab in the sidebar to see all worktree tasks grouped by status:

- **Active**: Currently running tasks with tri-state dots
  - Green pulse = actively producing output
  - Amber = idle/waiting
- **Review**: Completed tasks ready for merge
  - Shows commit count, changed files
  - Quick-action buttons: Merge, Diff, Push
- **Completed**: Successfully merged tasks

### Tri-State Status Dots

In the sidebar session list, worktree task sessions show special status indicators:
- **Pulsing green**: Agent is actively working (output in last 3 seconds)
- **Amber**: Agent is idle/waiting for input (idle 15+ seconds)
- **Blue checkmark**: Task is done, branch has commits ready for review

---

## Auto-Trust & Question Detection

> **What it is**: Automatically accepts trust/permission prompts from Claude Code so tasks can run unattended. Dangerous prompts (involving deletion, credentials, etc.) are flagged instead.

### Enabling

Go to **Settings** > enable **Auto-accept Trust Dialogs** under the Automation category.

### How It Works

1. Terminal output is continuously analyzed (200ms debounce)
2. Patterns like `(Y/n)`, `Trust this folder?`, `Proceed?`, `Allow tool access?` are detected
3. If the prompt is **safe**: auto-sends Enter to accept
4. If the prompt contains **danger keywords** (delete, credential, password, destroy, overwrite, etc.): the pane header shows an amber "Needs input" badge instead
5. 3-second cooldown between auto-accepts prevents runaway loops

### Safety

The following keywords prevent auto-accept:
`delete`, `remove`, `credential`, `password`, `token`, `destroy`, `overwrite`, `wipe`, `format`, `drop`

When a dangerous prompt is detected, you'll see the "Needs input" badge. Click the terminal pane and manually respond.

---

## Diff Viewer & Code Review

### Viewing Changes

For worktree task sessions, the detail panel shows a **Changed Files** section listing all files modified on the branch.

### Opening the Diff Viewer

- Click **View Diff** in the review banner (detail panel)
- Click **Diff** in the Tasks view
- Click any file in the Changed Files section

### Diff Viewer Features

- **File list sidebar**: All changed files with status icons (M/A/D/R) and +/- line counts
- **Syntax-highlighted diff**: Additions in green, deletions in red, context in muted
- **Hunk headers**: Sticky headers showing line ranges
- **Line numbers**: For easy reference
- **Per-file navigation**: Click any file to switch its diff

### Merging

Click **Merge** in either the review banner or Tasks view:

| Option | Description |
|--------|-------------|
| **Commit Message** | Pre-filled with task description, fully editable |
| **Squash commits** | Combines all branch commits into one clean commit |
| **Push to remote** | Pushes to remote after merge |

### Push for PR Workflow

Click **Push** to push the branch to remote without merging. Useful when you want to create a Pull Request on GitHub instead of merging locally.

---

## Templates

Save session configurations as reusable templates.

### Creating a Template

1. Open the prompt modal for a new session
2. Fill in the fields
3. Click **Save as Template**

### Using a Template

When creating a new session, template chips appear above the form. Click one to pre-fill all fields.

---

## Cost Tracking

tomnar's workbook tracks token usage and estimated costs for Claude sessions.

### How It Works

- Parses JSONL log files from `~/.claude/projects/`
- Applies per-model pricing (Opus, Sonnet, Haiku rates)
- Shows per-session and per-workspace totals

### Viewing Costs

- **Session detail**: Shows estimated cost with token breakdown
- **Costs view**: Aggregated costs across all sessions and time periods

---

## Search & Navigation

### Global Search

Press **Ctrl+K** to open the global search overlay. Search across:
- Session names
- Workspace names
- Working directories

### Quick Switcher

Press **Ctrl+P** to open the quick switcher for fast session navigation.

---

## Settings

Open with the **gear icon** in the header or **Ctrl+,**.

### Available Settings

| Setting | Category | Default | Description |
|---------|----------|---------|-------------|
| Pane Color Highlights | Terminal | ON | Colored borders on panes, matching pips in sidebar |
| Activity Indicators | Terminal | ON | Show activity dots on pane headers |
| Auto-open Terminal | Terminal | ON | Open terminal when starting a session |
| Completion Notifications | Notifications | ON | Desktop notifications when sessions go idle |
| Session Count in Header | Interface | ON | Show active session count in header stats |
| Confirm Before Close | Interface | ON | Confirm before closing terminal panes |
| Auto-accept Trust Dialogs | Automation | OFF | Auto-accept safe trust prompts |
| Enable Worktree Tasks | Advanced | OFF | Full worktree task system |

Settings are searchable and persist across sessions.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Ctrl+N** | New workspace |
| **Ctrl+K** | Global search |
| **Ctrl+P** | Quick switcher |
| **Ctrl+,** | Settings |
| **Ctrl+Shift+N** | New worktree task |
| **Ctrl+1-4** | Focus terminal pane 1-4 |
| **Escape** | Close current overlay/modal |

---

## Themes

Four Catppuccin themes available via the theme picker in the header:
- **Mocha** (default dark)
- **Macchiato** (warm dark)
- **Frappe** (soft dark)
- **Latte** (light)

All UI elements use CSS custom properties, so themes cascade everywhere including terminal panes, modals, and the diff viewer.
