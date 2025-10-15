# ADR-004: CWD Derivation Strategy

## Status

Accepted

## Context

watch-claude-think needs to map Claude Code project directories in `~/.claude/projects/` to the actual working directories where the user ran Claude. This is crucial for:

1. **Display**: Showing meaningful project names instead of encoded directory names
2. **Worktree detection**: Finding related git worktrees requires knowing the actual directory path
3. **User clarity**: Users think in terms of their project directories, not Claude's internal names

### The Challenge

Claude Code creates project directories with encoded path names. For example:

- User's project: `/Users/john/dev/my-project`
- Claude directory: `~/.claude/projects/-Users-john-dev-my-project`

The encoding rule appears simple: replace path separators with hyphens. However, **this encoding is not reversible** because hyphens can legitimately appear in directory names:

- `/Users/john/dev/my-project` → `-Users-john-dev-my-project`
- `/Users/john/dev-my/project` → `-Users-john-dev-my-project` (same!)

You cannot decode `-Users-john-dev-my-project` back to the original path without ambiguity. Is it `dev/my-project` or `dev-my/project`?

### Requirements

- Reliably determine the actual working directory for each Claude project
- Handle directories with hyphens in their names
- Work across platforms (Unix, Windows)
- Be maintainable and not rely on Claude's internal encoding scheme
- Fail gracefully if information is unavailable

## Decision

**Extract the working directory (cwd) directly from session files instead of attempting to decode project directory names.**

### Implementation Approach

Read the `cwd` field from messages in session files:

```typescript
async function extractCwdFromProject(projectPath: string): Promise<string | null> {
  // Read recent session files (up to 10, sorted by mtime)
  const recentSessions = await getRecentSessionFiles(projectPath);

  for (const sessionFile of recentSessions) {
    // Read first 20 lines looking for any message with a cwd field
    const cwd = await findCwdInFile(sessionFile);

    if (cwd) {
      return cwd; // Found it!
    }
  }

  return null; // No cwd found
}
```

### Why This Works

Every Claude Code session file contains messages with a `cwd` field:

```jsonl
{
  "type": "user",
  "cwd": "/Users/john/dev/my-project",  // ← The actual directory!
  "sessionId": "...",
  "message": { ... },
  // ...
}
```

This `cwd` value:

- Reflects where Claude was launched
- Is set by Claude Code itself (authoritative)
- Works regardless of encoding scheme
- Handles all special characters correctly
- Is available from first message onward

### Algorithm Details

```typescript
// 1. Find recent session files (most recent first)
const sessionFiles = await fs.readdir(projectPath);
const sessionFilesWithStats = await Promise.all(
  sessionFiles.map(async (file) => {
    const stats = await fs.stat(path.join(projectPath, file));
    return { file, mtime: stats.mtime };
  }),
);
sessionFilesWithStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
const recentSessions = sessionFilesWithStats.slice(0, 10);

// 2. Read first 20 lines of each session file
for (const { file } of recentSessions) {
  const rl = readline.createInterface({
    input: fs.createReadStream(path.join(projectPath, file)),
  });

  let lineCount = 0;
  for await (const line of rl) {
    if (lineCount++ >= 20) break;

    const entry = JSON.parse(line);
    if ('cwd' in entry && entry.cwd) {
      return entry.cwd; // Found it!
    }
  }
}
```

### Performance Characteristics

- **Best case**: First session, first line has cwd → 1 file open, 1 line read
- **Typical case**: First session, line 1-10 has cwd → 1 file open, ~5 lines read
- **Worst case**: Check 10 sessions, 20 lines each → 10 files open, 200 lines read

This is acceptable because:

- Happens once per project during project list loading
- Project list loading is infrequent (only on startup or project change)
- Reading 20 lines from 10 files is fast (~10ms total)
- Results can be cached

## Consequences

### Positive

1. **Reliable across all cases**
   - Handles directories with hyphens, spaces, unicode, etc.
   - Works regardless of Claude's encoding scheme
   - No ambiguity in path decoding

2. **Authoritative source**
   - Uses the actual `cwd` value from Claude's execution
   - Not inferring or guessing based on naming
   - If Claude has it wrong, we match Claude's behavior

3. **Platform independent**
   - Works on Unix, Windows, macOS
   - No path separator assumptions
   - Handles all file system quirks

4. **Maintainable**
   - Does not depend on Claude's internal encoding scheme
   - If Claude changes encoding, still works
   - Clear, understandable code

5. **Graceful degradation**
   - Returns `null` if no cwd found
   - Falls back to encoded directory name
   - Never crashes due to parsing errors

### Negative

1. **Requires file I/O**
   - Must read session files on startup
   - Slower than pure string manipulation
   - Need to handle file system errors

2. **Depends on session file format**
   - Assumes `cwd` field exists in messages
   - If Claude changes message format, may break
   - (But format has been stable and is part of core functionality)

3. **Empty projects have no cwd**
   - New projects with no sessions yet → no cwd
   - Must fall back to encoded name in this case
   - (Rare case - projects usually have sessions)

4. **Multiple file operations**
   - Check up to 10 session files
   - More syscalls than pure string parsing
   - (Mitigated by reading only first 20 lines and doing parallel reads)

### Neutral

1. **CWD can technically differ between sessions**
   - User could `cd` before running `claude` again
   - We take the most recent session's cwd
   - Log warning if cwds across sessions don't match

2. **Performance trade-off**
   - Slower startup (negligible - ~10ms per project)
   - Simpler, more correct code
   - Better user experience (correct names)

## References

- Implementation: `src/lib/file-system.ts:extractCwdFromProject()`
- Usage: `src/lib/file-system.ts:listProjects()`
- Message format: `src/types/claude-message.ts:ClaudeMessageEntry`
- Related: [ADR-005: Git Worktree Detection](./005-worktree-detection.md) (uses extracted cwd)

## Notes

### CWD Reliability During Session

Research findings (documented in codebase comments):

- The **initial cwd** (from first message) is always reliable
- **Later cwd values** in the same session can become unreliable after `cd` commands
- Claude updates cwd on some operations but not consistently
- For project identification, we only care about initial cwd (where Claude was launched)

### Cross-Session CWD Consistency

We check up to 10 recent sessions and take the first cwd found. If cwds differ across sessions (user `cd`'d before running Claude again), we log a debug warning but use the most recent:

```typescript
if (cwds.length > 1 && cwds.some((cwd) => cwd !== firstCwd)) {
  logger.debug('CWD mismatch across recent sessions', {
    projectPath,
    cwds,
    usingFirst: firstCwd,
  });
}
```

This is fine because:

- We just need a reasonable project name for display
- Most users run Claude from the same directory consistently
- If cwds differ, the most recent is probably most relevant

### Why 10 Sessions and 20 Lines?

These are heuristic values based on:

- **10 sessions**: Balances thoroughness with performance
- **20 lines**: Enough to find cwd in system messages, user messages, etc.
- **cwd appears early**: First or second message typically has cwd
- **Diminishing returns**: If not found in 10 × 20 = 200 lines, unlikely to find it elsewhere

Could make these configurable if needed, but current values work well in practice.

### Encoding Details (for reference)

While we don't decode, the encoding rules we've observed are:

- Path separators → hyphens: `/` becomes `-`, `\` becomes `-`
- Leading separator → leading hyphen: `/Users/...` → `-Users-...`
- Hyphens in names → preserved: `my-project` → `my-project`

This explains why decoding is ambiguous - hyphens from separators are indistinguishable from hyphens in names.
