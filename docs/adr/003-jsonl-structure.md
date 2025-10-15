# ADR-003: JSONL File Structure and Relationships

## Status

Accepted

## Context

watch-claude-think needs to read and parse Claude Code's conversation history to display messages in real-time. Understanding Claude Code's storage format is critical for correctly parsing, displaying, and tracking conversations.

### Claude Code's Storage Structure

```
~/.claude/projects/
├── -Users-john-my-project/          ← Project (encoded path)
│   ├── abc123-uuid.jsonl            ← Session 1
│   ├── def456-uuid.jsonl            ← Session 2
│   └── ghi789-uuid.jsonl            ← Session 3
└── -Users-jane-other-project/
    └── xyz890-uuid.jsonl
```

### Three-Level Hierarchy

Claude Code organizes conversations in a three-level hierarchy:

1. **Project** = Directory in `~/.claude/projects/`
   - Maps to a real filesystem directory (e.g., `/Users/john/my-project`)
   - Path encoded: slashes → dashes (`/Users/john/my-project` → `-Users-john-my-project`)
   - Contains multiple session files

2. **Session** = One `.jsonl` file within a project directory
   - Named with UUID: `{session-uuid}.jsonl`
   - Represents a long-running interaction with Claude
   - Can contain multiple conversation branches

3. **Conversation** = One branch within a session's message tree
   - Identified by leaf message UUID
   - Root-to-leaf path through parent chain
   - Multiple conversations exist when users branch (retry, edit)

### Key Questions

1. **Why JSONL format** instead of JSON, database, or other formats?
2. **Why one file per session** instead of one file per conversation or one file per project?
3. **How do conversations branch** within a single file?
4. **How does this affect watch-claude-think's architecture?**

## Decision

**Adopt Claude Code's three-level hierarchy as the domain model for watch-claude-think.**

We mirror Claude Code's terminology and structure:
- **Projects** are what users select
- **Sessions** are `.jsonl` files we watch
- **Conversations** are branches we can display individually

### Why JSONL Format

Claude Code uses **JSON Lines (JSONL)**: one JSON object per line, newline-delimited.

```jsonl
{"type":"user","uuid":"msg1","parentUuid":null,"content":"Hello"}
{"type":"assistant","uuid":"msg2","parentUuid":"msg1","content":"Hi"}
{"type":"summary","summary":"Greeting","leafUuid":"msg2"}
```

**Benefits:**
1. **Append-only** - New messages just append, no file rewrites
2. **Crash-resistant** - Each line is complete, no closing `]` needed
3. **Streaming** - Can parse line-by-line without loading entire file
4. **Simple** - No database overhead, no complex file locking

### Why One File Per Session

**Session = One `.jsonl` file** enables:

1. **Atomic session management** - All session data in one place
2. **Simple file watching** - Watch one file for all branches in that session
3. **Easy archival** - Copy/delete entire session with one file operation
4. **Natural boundaries** - Sessions represent distinct Claude invocations

**When new files are created:**
- `claude` (no flags) → new random UUID
- `/new`, `/reset`, `/clear` → new random UUID
- `--session-id <uuid>` → specified UUID
- `--resume`/`--continue` + `--fork-session` → new UUID, copies messages

**When existing files are reused:**
- `--resume <session-uuid>` → appends to existing file
- `--continue` → appends to most recent file

### Message Structure

Each message entry has:

```typescript
{
  type: 'user' | 'assistant',
  uuid: string,              // Unique message ID
  parentUuid: string | null, // Parent message (null for root)
  timestamp: string,
  sessionId: string,
  content: string | ContentBlock[],
  // ... other fields
}
```

**Parent chain** links messages:
```
msg1 (parentUuid: null)  ← Root
  └─ msg2 (parentUuid: msg1)
      └─ msg3 (parentUuid: msg2)  ← Leaf
```

### Branching Structure

**Branching happens when users retry or edit messages:**

```
msg1 (root)
  └─ msg2
      ├─ msg3a (Leaf A) ← Conversation 1
      └─ msg3b          ← Conversation 2
          └─ msg4b (Leaf B)
```

**Result:** One file, 5 messages, 2 conversations

**Leaf messages** = Messages with no children
- Identified by: not appearing in any `parentUuid` field
- Each leaf represents one conversation endpoint
- Summaries link to leaf UUIDs

### How watch-claude-think Uses This

```typescript
// 1. Projects: User selects from list
const projects = await listProjects();  // Reads ~/.claude/projects/

// 2. Conversations: User selects which branch to watch
const conversations = await listConversations(projectPath);
// Returns: { id, name, sessionPath, leafUuid, ... }[]

// 3. Sessions: We watch the actual .jsonl files
const sessionFiles = conversations.map(c => c.sessionPath);
sessionManager.watch(sessionFiles);

// 4. Messages: We parse and display
const messages = await parseFileTail(sessionPath);
```

## Consequences

### Positive

1. **Matches Claude Code's model**
   - Same terminology (projects, sessions, conversations)
   - Same file structure
   - Easy to document and explain

2. **Clean separation of concerns**
   - Projects = user's directory organization
   - Sessions = Claude invocation boundaries
   - Conversations = individual discussion threads

3. **Efficient file watching**
   - Watch one directory per project for new sessions
   - Watch specific `.jsonl` files for message updates
   - Clear mapping from user selection to files

4. **Natural user model**
   - Users think in terms of projects ("watch my-app")
   - Then refine to conversations ("show the debugging thread")
   - Matches mental model of Claude Code usage

5. **JSONL benefits for parsing**
   - Can read tail of file for recent messages (don't load entire history)
   - Can parse incrementally (track file position)
   - Can stream messages as they arrive

### Negative

1. **Complex conversation extraction**
   - Must build parent chains to identify conversations
   - Must find leaf messages (not in any parentUuid)
   - Must handle edge cases (orphaned messages, cycles)

2. **Multiple file formats in one file**
   - Messages, summaries, file snapshots all in same JSONL
   - Must filter by `type` field
   - Must handle unknown entry types gracefully

3. **Path encoding ambiguity**
   - Cannot reliably decode project path from directory name
   - Must read session files to extract actual `cwd`
   - See [ADR-005: CWD Derivation](./005-cwd-derivation.md)

4. **Branching complexity**
   - One file can contain many conversations
   - Need to understand entire message tree to extract one conversation
   - Performance: Must scan entire file to build conversation list

### Neutral

1. **Three levels of abstraction**
   - Clear boundaries between project/session/conversation
   - But three concepts to explain to users/contributors

2. **File-based storage**
   - Simple, no database required
   - But less powerful querying (no SQL, no indexes)

3. **UUID-based naming**
   - Unique, collision-resistant
   - But opaque to users (can't tell what session is from filename)

## Alternatives Considered

### Alternative 1: Flatten to Two Levels (Project → Conversation)

**Description**: Ignore the session concept, treat each conversation as independent.

```typescript
// What we would do:
const conversations = await listAllConversations(projectPath);
// Returns all leaves from all files, flattened
```

**Why rejected**:
- **Loses session context** - Can't tell which conversations were in same Claude invocation
- **Harder to watch** - Would need to watch all files simultaneously
- **Doesn't match Claude Code** - Users think in terms of sessions
- **Loses temporal grouping** - Sessions group related conversations by time

### Alternative 2: One File Per Conversation

**Description**: Store each conversation branch in its own file.

```
~/.claude/projects/-Users-john-project/
├── abc123-uuid-leaf1.jsonl  ← Conversation 1
├── abc123-uuid-leaf2.jsonl  ← Conversation 2 (branched)
└── def456-uuid-leaf1.jsonl  ← Different session
```

**Why rejected**:
- **Not how Claude Code works** - Would require converting their format
- **Duplicates shared messages** - msg1→msg2 would appear in both files
- **Harder to track branches** - Branching relationship lost
- **More file operations** - Create new file on every branch

### Alternative 3: Database Storage

**Description**: Parse Claude Code's files and import into SQLite/other DB.

```typescript
// What we would do:
await importSession(sessionPath, db);
const messages = db.query('SELECT * FROM messages WHERE sessionId = ?');
```

**Why rejected**:
- **Sync complexity** - Must keep DB in sync with Claude Code's files
- **Additional dependency** - DB setup, migrations, schema management
- **Latency** - Import step before displaying messages
- **Overkill** - File parsing is fast enough for our needs

### Alternative 4: Different Terminology

**Description**: Use different terms (e.g., "workspace" instead of "project").

**Why rejected**:
- **Confusing** - Users already know Claude Code's terms
- **Documentation burden** - Need to explain mapping
- **No benefit** - Renaming doesn't solve any problem
- **Consistency** - Better to match Claude Code exactly

## References

- Implementation: `src/lib/file-system.ts` (listProjects, listSessions, listConversations)
- Parsing: `src/lib/parser.ts` (extractSessionInfo, extractSummariesAndConversations)
- Types: `src/types/claude-message.ts` (JSONLEntry, ClaudeMessageEntry)
- Related: [ADR-004: CWD Derivation](./004-cwd-derivation.md)
- Related: [ADR-006: Sessions vs Conversations Model](./006-sessions-vs-conversations.md)

## Notes

### Message Types in JSONL

Claude Code stores multiple entry types in the same file:

```typescript
type JSONLEntry =
  | ClaudeMessageEntry    // User/assistant messages
  | SummaryEntry          // Conversation summaries
  | FileHistorySnapshot   // File state tracking
  | SystemEntry           // System messages (errors, boundaries)
```

We primarily care about:
- **ClaudeMessageEntry**: For displaying thinking blocks and user messages
- **SummaryEntry**: For naming conversations

### Leaf Message Detection

```typescript
// Algorithm to find leaf messages:
function findLeaves(messages: ClaudeMessageEntry[]): ClaudeMessageEntry[] {
  // Collect all UUIDs that appear as parents
  const parentUuids = new Set(
    messages.map(m => m.parentUuid).filter(p => p !== null)
  );

  // Messages NOT in that set are leaves (no children)
  return messages.filter(m => !parentUuids.has(m.uuid));
}
```

### Performance Characteristics

**Listing projects**: O(P) where P = number of project directories
- Read directory listing
- For each project, read first 20 lines of recent sessions for cwd
- Typically < 100ms for dozens of projects

**Listing conversations**: O(S × M) where S = sessions, M = messages per session
- Read all sessions in project
- Parse all messages to build tree
- Find leaves
- Extract/apply summaries
- Typically 100-500ms for active project

**Watching sessions**: O(1) for new messages
- File watcher triggers on append
- Read only new lines since last position
- Parse and display incrementally

### Future Considerations

1. **Caching**: Could cache conversation lists to avoid re-parsing
2. **Incremental updates**: Could update conversation list on file changes instead of full re-parse
3. **Lazy loading**: Could defer session parsing until user selects conversation
4. **Pagination**: Could paginate conversation list for projects with hundreds of sessions

But current performance is acceptable, so we keep it simple.
