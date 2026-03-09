# Remove Projects/Workspaces Concept

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the "Projects" (workspaces) organizational concept from the sidebar, leaving only "Launch Session" button and "Discovered" section.

**Architecture:** Surgical removal — stub out workspace functions as no-ops, remove HTML elements, redirect workspace view mode to terminal.

---

### Task 1: Remove workspace HTML from sidebar (index.html)

**Files:** Modify: `src/web/public/index.html`

- Remove lines 298-330: sidebar-view-toggle, sidebar-projects-header, workspace-list, sidebar-tasks-list, sidebar-footer/meta
- Remove line 331: sidebar-section-resize
- Remove lines 107-115: "Projects" header tab (data-mode="workspace")
- Remove lines 1069-1077: mobile "Projects" tab (data-view="workspace")
- Keep: Launch Session button (292-297), Discovered section (332-361), collapse bar (362-369)

### Task 2: Stub workspace functions in app.js

**Files:** Modify: `src/web/public/app.js`

- Make `renderWorkspaces()` a no-op: `renderWorkspaces() {}`
- Make `loadWorkspaces()` a no-op: `async loadWorkspaces() {}`
- This avoids having to touch 40+ call sites
- Remove the bodies of: `createWorkspace()`, `renameWorkspace()`, `deleteWorkspace()`
- Remove group management functions: `createGroup()`, `addWorkspaceToGroup()`, etc.
- Remove `initSidebarSectionResize()`
- Remove `setSidebarView()` and `renderSidebarTasks()`

### Task 3: Fix view mode handling in app.js

- In `setViewMode()`: remove the `mode === 'all'` → 'workspace' migration
- Anywhere `setViewMode('workspace')` is called, change to `setViewMode('terminal')`
- Remove workspace-specific element refs that will error (workspaceList, workspaceCount, createWorkspaceBtn, etc.)
- Remove workspace-related event listeners (sidebar view toggle clicks, section resize, create-workspace-btn)

### Task 4: Remove workspace-list click delegation

- The large click handler on `workspace-list` (lines ~1403-1793) handles drag/drop and workspace item interactions — remove entirely since the element no longer exists

### Task 5: CSS cleanup (optional, low priority)

- Remove workspace-specific CSS classes if they cause visual issues
- Ensure Discovered section fills the sidebar properly

### Task 6: Verify and commit
