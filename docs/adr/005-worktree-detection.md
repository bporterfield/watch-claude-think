# ADR-005: Git Worktree Detection and Grouping

## Status

Accepted

## Context

watch-claude-think displays a list of Claude Code projects to users. When developers use git worktrees to work on multiple branches simultaneously, they end up with multiple project directories that are actually part of the same codebase.

### The User Experience Problem

**Without worktree detection:**
```
Projects:
- my-app (main branch)
- my-app-feature-auth (feature branch)
- my-app-bugfix-123 (bugfix branch)
```

These appear as three separate projects, even though they're all part of the same repository. Users must mentally map which projects are related, and the list gets cluttered with multiple entries for the same codebase.

**With worktree detection:**
```
Projects:
▼ my-app
  - main (main repo)
  - feature-auth (worktree)
  - bugfix-123 (worktree)
```

Related projects are visually grouped, making it clear they're part of the same repository and easier to find the branch you want.

### Git Worktrees Explained

Git worktrees allow checking out multiple branches of the same repository simultaneously in different directories:

```bash
# Main repository
cd /Users/john/my-app
git branch main

# Create worktrees for parallel work
git worktree add ../my-app-feature /refs/heads/feature
git worktree add ../my-app-bugfix /refs/heads/bugfix
```

**Key characteristic:** Main repo has `.git` as a **directory**, worktrees have `.git` as a **file**.

### Detection Requirements

We need to:
1. **Identify worktrees** - Distinguish worktree directories from main repos
2. **Find main repo** - Given a worktree, find its parent main repository
3. **List related worktrees** - Get all worktrees for a given repository
4. **Extract branch names** - Show which branch each worktree/repo is on
5. **Cross-platform compatibility** - Work on Unix, macOS, and Windows

## Decision

**Use git's native distinction between worktrees and main repos: `.git` file vs `.git` directory.**

### Detection Algorithm

**Step 1: Identify if directory is a worktree**

```typescript
const gitPath = path.join(cwd, '.git');
const gitStat = await fs.stat(gitPath);

// Main repo: .git is directory
// Worktree: .git is file (contains pointer to main repo)
const isWorktree = gitStat.isFile();
```

**This is reliable because it's standard git behavior:**
- Main repos always have `.git` as directory
- Worktrees always have `.git` as file
- Git itself relies on this distinction

**Step 2: Parse worktree's `.git` file to find main repo**

The `.git` file in a worktree contains a single line:
```
gitdir: /path/to/main/.git/worktrees/worktree-name
```

**Parsing algorithm:**
```typescript
// Read .git file content
const gitFileContent = await fs.readFile(gitPath, 'utf-8');
const match = gitFileContent.match(/^gitdir:\s*(.+)$/m);
const gitdir = match[1].trim();
// Example: "/Users/john/my-app/.git/worktrees/feature"

// Normalize to OS-appropriate separators
const normalizedGitdir = path.normalize(gitdir);
// Unix: /Users/john/my-app/.git/worktrees/feature
// Windows: C:\Users\john\my-app\.git\worktrees\feature

// Split by separator and find .git component
const parts = normalizedGitdir.split(path.sep);
// ["", "Users", "john", "my-app", ".git", "worktrees", "feature"]

// Find index of .git
const gitIndex = parts.findIndex((p) => p === '.git');
// 4

// Take everything before .git
mainRepoPath = parts.slice(0, gitIndex).join(path.sep);
// "/Users/john/my-app"
```

**Why this works:**
- Path always has `.git` as a component (standard git structure)
- Split → find `.git` → take everything before = main repo path
- OS-independent (uses `path.sep` for current platform)
- Simple string operations, no regex edge cases

**Step 3: Get all related worktrees and branches**

```typescript
const { stdout } = await execAsync('git worktree list --porcelain', { cwd });
```

**Porcelain format is stable, parseable output:**
```
worktree /Users/john/my-app
HEAD abc123...
branch refs/heads/main

worktree /Users/john/my-app-feature
HEAD def456...
branch refs/heads/feature

worktree /Users/john/my-app-bugfix
HEAD ghi789...
branch refs/heads/bugfix
```

**Parsing logic:**
```typescript
const lines = worktreeList.split(/\r?\n/);
let currentWorktree: { path: string; branch: string; isMain: boolean } | null = null;

for (const line of lines) {
  if (line.startsWith('worktree ')) {
    // Save previous worktree
    if (currentWorktree) relatedWorktrees.push(currentWorktree);

    // Start new worktree
    const worktreePath = line.slice('worktree '.length);
    currentWorktree = {
      path: path.normalize(worktreePath),
      branch: '',
      isMain: false,
    };
  } else if (line.startsWith('branch ') && currentWorktree) {
    currentWorktree.branch = line
      .slice('branch '.length)
      .replace(/^refs\/heads\//, ''); // Strip refs/heads/ prefix
  } else if (line === '' && currentWorktree) {
    // Empty line = end of entry
    relatedWorktrees.push(currentWorktree);
    currentWorktree = null;
  }
}

// First worktree in list is main repo
relatedWorktrees[0].isMain = true;
```

## Consequences

### Positive

1. **Standard git behavior**
   - Uses git's native file vs directory distinction
   - No custom detection heuristics needed
   - Works with all git versions

2. **Reliable across platforms**
   - `.git` file/directory check works everywhere
   - `path.normalize()` handles Windows vs Unix separators
   - Git internally uses forward slashes consistently in `.git` file content
   - No platform-specific code paths

3. **Simple parsing algorithm**
   - Split path by separator → find `.git` → take prefix
   - No complex regex or path manipulation
   - Easy to understand and maintain

4. **Porcelain format stability**
   - `--porcelain` flag guarantees stable output format across git versions
   - Designed for programmatic parsing
   - Forward-compatible with git updates

5. **Gets all information in one pass**
   - Single `git worktree list` returns all worktrees + branches
   - No need for multiple git commands
   - Fast even with many worktrees

6. **Improved UX**
   - Users see logical grouping of related worktrees
   - Easier to find specific branch
   - Less clutter in project list

### Negative

1. **Requires git command**
   - Must have `git` in PATH
   - External dependency (though minimal - git is ubiquitous)
   - Need to handle command execution errors

2. **Parsing complexity**
   - Must parse porcelain format correctly
   - Handle edge cases (detached HEAD, bare repos, etc.)
   - Cross-platform line ending handling (`\r?\n`)

3. **Performance**
   - Extra file I/O to check `.git` file
   - Extra git command execution for worktree list
   - ~10-50ms per project (acceptable but measurable)

4. **Limited to git repositories**
   - Non-git projects don't benefit from grouping
   - Adds complexity only useful for git users
   - (But most users do use git)

5. **Fails silently without git**
   - If `git` command not available, falls back to no grouping
   - No warning to user that grouping is unavailable
   - (Acceptable - non-critical feature)

### Neutral

1. **Worktree info is optional**
   - ProjectInfo.worktreeInfo is optional field
   - Rest of app works without worktree detection
   - Clean fallback to ungrouped display

2. **Only runs on initial project load**
   - Worktree relationships don't change frequently
   - No need to re-check on every file change
   - Performance impact limited to startup

3. **Branch names included**
   - Useful for display, but not strictly necessary
   - Adds extra parsing complexity
   - Nice to have for UX

## Alternatives Considered

### Alternative 1: Check for `.git/worktrees/` Directory

**Description**: Identify main repos by checking for `.git/worktrees/` directory.

```typescript
const worktreesDir = path.join(cwd, '.git', 'worktrees');
const hasWorktrees = await fs.stat(worktreesDir).then(() => true).catch(() => false);
```

**Why rejected**:
- **Doesn't identify worktrees themselves** - Only finds main repos that *have* worktrees
- **Main repos without worktrees look the same** as standalone repos
- **Misses half the problem** - Can't find main repo from a worktree
- **Requires parsing `.git` file anyway** to link worktree to main repo

### Alternative 2: Parse Git Config Files

**Description**: Read `.git/config` to determine repository relationships.

```typescript
const gitConfig = await fs.readFile(path.join(cwd, '.git', 'config'), 'utf-8');
// Parse for remote origin, worktree settings, etc.
```

**Why rejected**:
- **Config format is complex** - INI-like format with sections and inheritance
- **Not designed for this** - Config doesn't explicitly encode worktree relationships
- **Fragile** - Config structure can vary across git versions and setups
- **More work than needed** - `.git` file/directory distinction is simpler and more direct

### Alternative 3: Use Git API Libraries

**Description**: Use `isomorphic-git` or `nodegit` instead of git commands.

```typescript
import git from 'isomorphic-git';
const worktrees = await git.listWorktrees({ fs, dir: cwd });
```

**Why rejected**:
- **Heavy dependencies** - `nodegit` requires native compilation, `isomorphic-git` is large
- **Incomplete APIs** - Many git libraries don't expose worktree APIs
- **Maintenance burden** - Library updates, breaking changes, compatibility issues
- **Overkill** - We only need two simple operations (stat `.git`, run one git command)
- **Git CLI is ubiquitous** - Users already have git installed

### Alternative 4: String Matching on Directory Names

**Description**: Assume worktrees follow naming pattern like `project-branch`.

```typescript
if (projectName.includes('-') && existsSync(`../${projectName.split('-')[0]}`)) {
  // Probably a worktree?
}
```

**Why rejected**:
- **Unreliable** - Users can name worktrees anything
- **False positives** - Many projects have hyphens in names
- **Doesn't actually verify git relationship** - Just guessing based on names
- **No way to find main repo** - Can't determine actual parent
- **Brittle** - Breaks with any naming convention change

### Alternative 5: Ask Git for Worktree via Rev-Parse

**Description**: Use `git rev-parse --git-common-dir` to find main repo.

```typescript
const { stdout } = await execAsync('git rev-parse --git-common-dir', { cwd });
const commonDir = stdout.trim();
// Parse to find main repo
```

**Why rejected**:
- **Still need to parse output** - Returns path to `.git` or `.git/worktrees/name`
- **Same parsing complexity** as reading `.git` file
- **Extra git command** without simplifying logic
- **`.git` file check is more direct** - Why execute command when file check suffices?
- **Would combine with our approach anyway** - Still need worktree list command

## References

- Implementation: `src/lib/file-system.ts:getWorktreeInfo()` (lines 174-297)
- Usage: `src/lib/file-system.ts:listProjects()` (line 167)
- Types: `src/types/file-system.ts:WorktreeInfo` (lines 17-27)
- UI grouping: `src/components/ProjectSelector.tsx` (worktree display logic)
- Related: [ADR-004: CWD Derivation](./004-cwd-derivation.md) (CWD extraction feeds into worktree detection)

## Notes

### Git's Path Separator Behavior

Git **always uses forward slashes** (`/`) in its internal formats, even on Windows.

**Example `.git` file content on Windows:**
```
gitdir: C:/Users/john/my-app/.git/worktrees/feature
```

NOT:
```
gitdir: C:\Users\john\my-app\.git\worktrees\feature
```

**Why we use `path.normalize()`:**
- Converts git's forward slashes to OS-appropriate separators
- Makes path splitting work correctly with `path.sep`
- Enables cross-platform code without special cases

**Code comments mention backslashes** (line 208), but this is defensive - git does not emit backslashes in practice. The normalization handles it anyway, so no harm in being defensive.

### Porcelain Format Stability

The `--porcelain` flag promises:
- Stable output format across git versions
- Machine-readable structure
- Forward compatibility

This is why we use `git worktree list --porcelain` instead of plain `git worktree list` (which has human-readable format that could change).

**Format documentation:**
- Each worktree = block separated by blank lines
- Lines: `worktree <path>`, `HEAD <sha>`, `branch <ref>`, optional `bare`
- Order: Main repo first, then worktrees in creation order

### Performance Characteristics

**Worktree detection adds ~10-50ms per project:**
- File stat: ~1ms
- Read `.git` file: ~1ms
- Parse path: <1ms
- `git worktree list`: ~5-30ms (depends on number of worktrees)

**Mitigation:**
- Only runs during initial project list load (infrequent)
- Runs in parallel across projects (Promise.all)
- Results cached in ProjectInfo structure
- Acceptable latency for improved UX

**Typical project load with 10 projects:**
- Without worktree detection: ~50ms
- With worktree detection: ~100-150ms
- User perceives both as instant

### Worktree Detection Edge Cases

**Detached HEAD worktrees:**
- `branch` line missing in porcelain output
- We handle by leaving branch as empty string
- Display logic should show SHA or "detached HEAD"

**Bare repositories:**
- Main repo can be bare (no working tree)
- Identified by `bare` line in porcelain output
- We mark as isMain but handle display differently

**Deleted worktrees:**
- `.git/worktrees/` can contain stale entries
- `git worktree list` only shows active worktrees
- Prune with `git worktree prune` (user responsibility)

**Worktrees outside parent directory:**
- Worktrees can be anywhere on filesystem
- Our detection still works (parse absolute paths)
- UI grouping may look strange if paths very different

### Why First Worktree is Main Repo

Git's `git worktree list` always lists the main repository first, then worktrees in creation order. This is guaranteed by git's implementation.

```typescript
// First worktree in the list is typically the main repo
if (relatedWorktrees.length > 0 && relatedWorktrees[0]) {
  relatedWorktrees[0].isMain = true;
}
```

This is reliable across all git versions.

### UI Integration

**Project selector displays:**
```tsx
{project.worktreeInfo?.isWorktree && (
  <Text dimColor>↳ worktree of {project.worktreeInfo.mainRepoPath}</Text>
)}

{project.worktreeInfo?.relatedWorktrees.map(wt => (
  <Text>  {wt.isMain ? '●' : '○'} {wt.branch}</Text>
))}
```

**Visual hierarchy:**
- Main repos shown with normal styling
- Worktrees indented or marked with visual indicator
- Branch names shown for context
- Grouped projects collapsed/expanded together

### Future Considerations

1. **Cache worktree info** - Store in memory, refresh only on directory change
2. **Notify on worktree changes** - Watch `.git/worktrees/` for additions/removals
3. **Auto-create worktrees** - UI action to create new worktree from current project
4. **Branch switching** - Quickly switch between worktrees of same repo
5. **Stale worktree detection** - Warn about `.git/worktrees/` entries that should be pruned

Current implementation provides foundation for these enhancements.
