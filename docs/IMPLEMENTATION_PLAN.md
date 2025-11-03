# Implementation Plan: Watch All Sessions Including Worktrees

## Overview

Add ability to watch all sessions across git worktrees when user selects a project that has related worktrees. This allows developers working with multiple worktrees to monitor Claude conversations across all branches simultaneously.

## Stage 1: Enhance SessionSelector UI

**Goal**: Add "Watch all sessions (including worktrees)" option when worktrees are detected

**Criteria**:
- New option appears in SessionSelector when `project.worktreeInfo?.relatedWorktrees` is non-empty
- Option shows count of worktrees (e.g., "Watch all sessions (3 worktrees)")
- Option appears before "Watch all conversations" option
- Selecting option signals to parent component to use multi-worktree mode
- Option only shown when on main repo or a worktree with detected related worktrees

**Files**:
- `src/components/SessionSelector.tsx` - Add new option, detect worktrees
- `src/components/App.tsx` - Handle new selection type in stage transition

**Tests**:
- Type safety verified (TypeScript compilation passes)
- Build succeeds with changes
- API contract verified through type system
- Component tests deferred (project uses library-level testing, not component testing)

**Status**: Complete

---

## Stage 2: Multi-Directory SessionWatcher

**Goal**: Enable SessionWatcher to watch multiple project directories simultaneously

**Criteria**:
- SessionWatcher accepts multiple directory paths in constructor
- Uses Chokidar's multi-path watching: `chokidar.watch(paths)`
- Tracks which session files belong to which project directory
- Emits project path along with file path in change events
- Maintains same queue-based processing to prevent race conditions
- All existing single-directory functionality still works

**Files**:
- `src/lib/session-watcher.ts` - Modify constructor, watch setup, event handlers

**Implementation Notes**:
- Change constructor: `constructor(projectPaths: string[], options?: SessionWatcherOptions)`
- Or keep backward compatible: `constructor(projectPath: string | string[], options?)`
- Track file-to-project mapping: `Map<filePath, projectPath>`
- Emit events with project context: `{ filePath, projectPath, ... }`

**Tests**:
- ✅ Watch multiple directories simultaneously (via array parameter)
- ✅ Detect file changes from each directory
- ✅ Correctly identify which directory each file belongs to (fileToProjectMap)
- ✅ Single directory mode still works (backward compatibility via string|array)
- ✅ Queue processes events from all directories in order (PQueue maintained)
- ✅ All existing tests pass (143 tests)

**Status**: Complete

---

## Stage 3: Multi-Project SessionManager

**Goal**: Handle sessions from multiple project directories with proper project identification

**Criteria**:
- SessionManager accepts multiple project paths with their names
- Maps session files to their source project directory
- Passes project information to UI for visual distinction
- Maintains existing single-project functionality
- Each project gets unique color assignment

**Files**:
- `src/lib/session-manager.ts` - Constructor, project tracking, session mapping
- `src/lib/types.ts` - Update types if needed to include project context

**Implementation Notes**:
- Change to: `Map<projectPath, projectName>` for tracking multiple projects
- Add `projectPath` to session metadata
- Ensure messages include project identifier for coloring
- Project colors already assigned in `assignProjectColors()` (src/lib/utils.ts:44-67)

**Tests**:
- ✅ Manage sessions from multiple projects (projectPaths array + projectPathToNameMap)
- ✅ Correctly map files to their projects (sessionFilesMap includes projectPath)
- ✅ Project information flows to UI components (projectPath in callbacks used)
- ✅ Single project mode unchanged (backward compatible)
- ✅ All existing tests pass (143 tests)

**Status**: Complete

---

## Stage 4: App State & Flow Integration

**Goal**: Wire up multi-worktree watching from selection through to display

**Criteria**:
- App.tsx handles "watch all with worktrees" selection
- Collects all related worktree paths from `project.worktreeInfo.relatedWorktrees`
- Maps worktree directory paths to their Claude project directories
- Passes multiple project paths to SessionManager
- StreamView receives and displays messages from all worktrees
- Existing single-project flow unaffected

**Files**:
- `src/components/App.tsx` - Selection handling, worktree path collection
- `src/lib/file-system.ts` - May need helper to map worktree dir → project dir

**Implementation Notes**:
- Worktree paths from `relatedWorktrees` are working directory paths
- Need to map them to `~/.claude/projects/` directories
- Use `claudeDirectoryToProjectName()` (file-system.ts:29-38) for mapping
- Include current project + all related worktrees in array

**Tests**:
- ✅ Added getProjectPathForWorktree() helper to map worktree paths
- ✅ App.tsx collects sessions from all related worktrees
- ✅ Worktree paths correctly mapped to Claude project directories
- ✅ All worktree sessions passed to SessionManager
- ✅ Single project selection still works (backward compatible)
- ✅ All existing tests pass (143 tests)

**Status**: Complete

---

## Stage 5: Visual Distinction & Polish

**Goal**: Ensure messages clearly show which worktree/branch they originate from

**Criteria**:
- Each worktree's messages have distinct color (already implemented via project colors)
- Project/branch name visible in message display
- Legend or indicator shows which color = which worktree/branch
- Clear visual separation between different worktrees
- Performance acceptable with multiple worktrees

**Files**:
- `src/components/StreamView.tsx` - Project labels/legend
- `src/components/MessageList.tsx` - Message display with project info
- `src/lib/utils.ts` - Verify color assignment

**Implementation Notes**:
- Project colors already assigned via `assignProjectColors()` (utils.ts:44-67)
- May want to show branch name with project name
- Consider adding legend showing "color → branch" mapping
- Existing `MessageList` already uses project colors for role colors

**Tests**:
- ✅ Messages from different worktrees have different colors (via assignSessionColors)
- ✅ Project/branch name visible in message display ([projectName / sessionName] format)
- ✅ Each worktree identified by unique color + branch name label
- ✅ Visual polish matches existing UI style (leverages existing infrastructure)
- ✅ showProjectName logic works correctly for multi-worktree scenario
- ✅ All existing tests pass (143 tests)

**Status**: Complete

---

## Technical Architecture Notes

### Existing Infrastructure (Already Implemented)

✅ **Worktree Detection** (`src/lib/file-system.ts:163-286`):
- `getWorktreeInfo()` detects all related worktrees
- Returns `relatedWorktrees: string[]` with paths
- Called during `listProjects()`, attached to each `ProjectInfo`

✅ **Project Colors** (`src/lib/utils.ts:44-67`):
- `assignProjectColors()` assigns unique colors per project
- Already supports multiple projects

✅ **Multi-Path File Watching**:
- Chokidar supports: `chokidar.watch([path1, path2, ...])`
- No library changes needed

✅ **Queue-Based Processing** (`src/lib/session-watcher.ts:48-56`):
- PQueue serializes file operations
- Already prevents race conditions
- Will scale to multiple directories

### Key Challenges

1. **Path Mapping**: Worktree working directory → Claude project directory
   - Worktree path: `/Users/foo/repo-worktree-branch`
   - Claude project: `~/.claude/projects/-Users-foo-repo-worktree-branch/`
   - Use existing `claudeDirectoryToProjectName()` helper

2. **Backward Compatibility**: Must not break single-project watching
   - Keep single-path constructor option
   - Normalize to array internally
   - All tests should still pass

3. **Performance**: Watching many directories
   - Chokidar efficiently handles multiple paths
   - Queue prevents overwhelming system
   - Test with 5+ worktrees to verify

### Definition of Done for Full Feature

- [x] User can select "Watch all sessions (N worktrees)" option
- [x] Sessions from all related worktrees appear in stream
- [x] Each worktree's messages are color-coded and labeled
- [x] Existing single-project watching unchanged
- [x] All tests passing (143 tests)
- [x] No console.log statements left in code
- [x] `npm run check` passes
- [x] Ready for testing with real worktrees
