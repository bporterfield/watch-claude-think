# ADR-006: Sessions vs Conversations Model

## Status

Accepted

## Context

watch-claude-think monitors Claude Code activity by reading `.jsonl` files in `~/.claude/projects/`. Understanding how Claude Code organizes conversation data is critical to providing a useful interface.

### Claude Code's Storage Model

**Session = File**
- Each session is one `.jsonl` file: `~/.claude/projects/{project}/{session-uuid}.jsonl`
- The file is append-only: new messages are written to the end
- One file can contain multiple conversation branches

**Conversation = Branch**
- A conversation is a single message chain from root to leaf within a session file
- Root message: First message in chain (`parentUuid: null`)
- Leaf message: Last message in chain (no other messages reference it as parent)
- Multiple conversations can exist in one file due to branching

**Example: Branching creates multiple conversations in one file**
```
session-abc123.jsonl contains:
  msg1 (root, parentUuid: null)
    ├─→ msg2
    │    ├─→ msg3a (leaf) ← Conversation A: "Try quicksort"
    │    └─→ msg3b
    │         └─→ msg4b (leaf) ← Conversation B: "Try mergesort instead"

One file, two conversations (two leaves).
```

**Resuming creates conversations across files**
```
session-old.jsonl:
  msg1 → msg2 → msg3 (leaf)
  {"type":"summary","leafUuid":"msg3","summary":"Implement caching"}

session-new.jsonl:
  {"type":"summary","leafUuid":"msg3","summary":"Implement caching"}
  msg4 (parentUuid: "msg3") → msg5 (leaf)

Two files, one logical conversation (old leaf → new messages).
```

### The Challenge

Users need to:
1. **See conversations** - "Implement caching with Redis", not "session-abc123.jsonl"
2. **Select specific branches** - Not "watch this file with 3 unrelated branches"
3. **Match Claude's UX** - `/resume` command shows conversations, not files

But we must:
1. **Watch files** - New messages appear in `.jsonl` files, not "conversations"
2. **Handle branching** - Multiple conversations share the same file
3. **Support resuming** - Conversations can span multiple files

This creates a tension: users think in conversations, but files are the unit of I/O.

## Decision

**Show conversations in the UI, but watch sessions (files) under the hood.**

### Session Model (File-Level Operations)

**Definition:** A session is a single `.jsonl` file containing all messages and metadata.

**Interface:**
```typescript
interface SessionInfo {
  id: string;           // Filename without .jsonl extension
  name: string;         // Display name (from summary or first user message)
  path: string;         // Absolute file path
  mtime: Date;          // File modification time
}
```

**Used for:**
- File watching (`SessionManager` watches `.jsonl` files)
- File I/O operations (reading, parsing, stat checks)
- Detecting file changes (mtime, file system events)
- Filtering compacted/resumed sessions

**API:**
```typescript
listSessions(projectPath: string): Promise<SessionInfo[]>
```

### Conversation Model (Branch-Level Operations)

**Definition:** A conversation is a single message chain from root to leaf within a session file.

**Interface:**
```typescript
interface ConversationInfo {
  id: string;           // Unique: `${sessionId}-${leafUuid}`
  name: string;         // Summary or fallback to first user message
  sessionPath: string;  // Path to the .jsonl file
  sessionId: string;    // Session file id (for grouping)
  leafUuid: string;     // The leaf message UUID identifying this branch
  mtime: Date;          // Timestamp of leaf message (last message)
}
```

**Used for:**
- UI display (session picker shows conversations)
- User selection (user picks a conversation branch)
- Summary matching (summaries link to leaf UUIDs)
- Cross-file relationships (resumed conversations)

**API:**
```typescript
listConversations(projectPath: string): Promise<ConversationInfo[]>
```

### How Conversations Are Discovered

**Step 1: Read all session files**
- Parse each `.jsonl` file to extract messages
- Collect all summaries from top of files

**Step 2: Find leaf messages**
- Collect all UUIDs that appear as `parentUuid` in some message
- Messages NOT in that set are leaves (endpoints with no children)
```typescript
const parentUuids = new Set(messages.map(m => m.parentUuid).filter(p => p));
const leaves = messages.filter(m => !parentUuids.has(m.uuid));
```

**Step 3: Build conversation chains**
- For each leaf, walk backwards to root following `parentUuid` links
- Count messages to understand conversation size
- Extract first user message as fallback name

**Step 4: Match summaries**
- Build global summary map: `leafUuid → summary text` (from ALL files)
- Apply summaries to conversations (enables cross-file matching for resumed sessions)
- Fall back to first user message text if no summary exists

**Result:** One `ConversationInfo` per leaf message, with meaningful names.

### Session Picker Shows Conversations

The UI presents conversations to match Claude's `/resume` experience:

```
Resume a conversation:

  → Implement caching with Redis        [Most recent]
    Try alternative sorting approach
    Debug performance issue

[Arrow keys to select, Enter to watch]
```

Each entry is a conversation (leaf), not a file. User sees meaningful summaries, not file names.

### File Watching Operates on Sessions

When user selects a conversation:
1. Identify which session file contains it (`conversation.sessionPath`)
2. Watch that entire `.jsonl` file for changes
3. Parse new messages and filter to selected conversation

**Why watch entire file:**
- We can't watch "part of a file" - files are atomic I/O units
- All branches share the same file - no way to separate them at I/O level
- File system events trigger on file changes, not conversation changes

**Consequence:** If user selects "Conversation A" but "Conversation B" gets a new message, we'll parse it but won't display it (filtered by leaf UUID).

### Compaction and Resume Filtering

**Problem:** When a session is resumed, Claude creates:
- Old file: `session-old.jsonl` with original conversation
- New file: `session-new.jsonl` with summary referencing old leaf + new messages

Both files exist on disk. Should we show both?

**Decision:** Show only the resumed session, hide the original.

**Algorithm:**
1. Collect all `leafUuid` values from summary entries in ALL files
2. For each session without a summary (original sessions):
   - Get its last message UUID
   - If that UUID appears in the leafUuid set → it was resumed → hide it
3. Show only sessions with summaries OR originals that haven't been resumed

**Code reference:** `file-system.ts:421-464` (listSessions compaction logic)

### "Watch All Sessions" Mode

User can select "Watch All Sessions" instead of picking one conversation.

**Behavior:**
- Load all conversations in the project
- Extract unique session file paths
- Watch all session files simultaneously
- Display interleaved messages from all conversations

**Implementation:**
- UI shows all conversations initially
- User picks "all"
- SessionManager watches multiple files
- MessageStore displays messages from all sources

## Consequences

### Positive

1. **Matches Claude's UX**
   - Session picker shows conversations like `/resume` command
   - Users see meaningful summaries, not file names
   - Familiar experience for Claude Code users

2. **Handles branching correctly**
   - Each conversation branch is selectable independently
   - Branched conversations in one file shown as separate options
   - User can choose which branch to follow

3. **Supports resumed sessions**
   - Cross-file summary matching works correctly
   - Old sessions are hidden (compaction filtering)
   - Logical conversations span files seamlessly

4. **Clear architectural separation**
   - Session APIs handle file I/O
   - Conversation APIs handle user-facing operations
   - Each layer operates at appropriate abstraction level

5. **Scales to complex projects**
   - Projects with many branches and resumes work correctly
   - Compaction filtering prevents showing duplicate/stale sessions
   - Global summary map enables cross-file lookups

### Negative

1. **Expensive conversation discovery**
   - Must read ALL files to build global summary map
   - Must parse messages to find leaves (O(n) per file)
   - Performance: ~100-500ms for 10-20 session files
   - Mitigated: Only done at startup and when user navigates back to picker

2. **Watch entire files, not branches**
   - Selecting one conversation still watches whole file (all branches)
   - Must parse and filter messages for non-selected branches
   - Wasteful if file has many unrelated branches
   - Mitigated: Filtering is fast, parsing is already incremental

3. **Two parallel APIs**
   - `listSessions()` and `listConversations()` must stay in sync
   - Different logic paths for session vs conversation operations
   - More complex testing (need tests for both APIs)

4. **Potential confusion**
   - "Session" and "conversation" terminology not obvious to new contributors
   - Code must carefully choose which model to use in each context
   - Types help (SessionInfo vs ConversationInfo), but still cognitive load

### Neutral

1. **Session files are physical, conversations are logical**
   - Sessions map to file system (disk reality)
   - Conversations map to user intent (logical structure)
   - This distinction is inherent to Claude's design, not our choice

2. **Different data needed in different contexts**
   - Session data: file paths, mtimes, file operations
   - Conversation data: leaf UUIDs, summaries, cross-file links
   - Must maintain both models

## References

### Implementation
- Session model: `src/lib/file-system.ts:36-41` (SessionInfo)
- Conversation model: `src/lib/file-system.ts:43-50` (ConversationInfo)
- Session listing: `src/lib/file-system.ts:394-476` (listSessions with compaction)
- Conversation listing: `src/lib/file-system.ts:484-580` (listConversations with global summaries)
- Leaf detection: `src/lib/parser.ts:905-909` (parentUuids set logic)
- UI usage: `src/components/App.tsx:80` (shows conversations, not sessions)

### Related ADRs
- [ADR-003: JSONL File Structure](./003-jsonl-structure.md) - Message parent/child relationships
- [ADR-007: Summary Handling](./007-summary-handling.md) - Cross-file summaries and orphan detection

### Tests
- Session listing: `test/unit/session-manager.test.ts`
- Conversation discovery: `test/unit/conversation-discovery.test.ts`

## Notes

### Real-World Example

**Scenario:** User working on a feature, tries two approaches

1. **Initial work** → creates `session-001.jsonl`
   - msg1: "Help me optimize this function"
   - msg2: Assistant suggests approach A
   - Summary: "Optimize function with memoization"

2. **User tries different approach** → retries last message (branching)
   - Same file `session-001.jsonl` now has:
     - Branch A: msg1 → msg2a (memoization) [leaf: msg2a]
     - Branch B: msg1 → msg2b (Redis) [leaf: msg2b]
   - Two summaries, two conversations, one file

3. **User resumes next day** → `claude --resume` → creates `session-002.jsonl`
   - New file: `session-002.jsonl`
   - Contains: summary linking to msg2b, new messages continuing from there
   - Compaction: session-001 is now hidden (last message is resumed in 002)

**watch-claude-think shows:**
- "Optimize with Redis" (session-002.jsonl, leaf: msg2b continued)
- "Optimize with memoization" (session-001.jsonl, leaf: msg2a)

User picks "Optimize with Redis" → we watch session-002.jsonl

### When to Use Which Model

**Use SessionInfo when:**
- Implementing file watchers
- Reading/writing files
- Checking file modification times
- Managing file-level caching
- Detecting compacted/resumed files

**Use ConversationInfo when:**
- Building UI selection menus
- Displaying names to users
- Matching summaries to conversations
- Handling cross-file relationships
- Filtering messages by leaf UUID

### Terminology Mapping

| Term | Meaning | Example |
|------|---------|---------|
| **Session** | One `.jsonl` file | `session-abc123.jsonl` |
| **Conversation** | Message chain (root → leaf) | "Implement caching" |
| **Branch** | Conversation in multi-branch session | "Try quicksort" vs "Try mergesort" |
| **Leaf** | Last message in chain (no children) | Message with UUID not referenced as parent |
| **Root** | First message in chain | Message with `parentUuid: null` |
| **Resume** | Continue in new file | New file references old leaf UUID |
| **Compaction** | Hiding old files after resume | session-old hidden when session-new resumes it |

### Future Considerations

1. **Caching conversation list** - listConversations is expensive, could cache results
2. **Incremental updates** - Re-scan only changed files instead of all files
3. **Better terminology** - Consider renaming SessionInfo to FileInfo to reduce confusion?
4. **Per-branch watching** - Could we track which messages belong to selected branch more efficiently?
5. **Resume chains** - Handle multi-level resumes (A → B → C)

The current two-model approach handles all Claude Code features correctly. Future optimizations should maintain this clarity.
