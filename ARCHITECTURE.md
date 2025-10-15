# Architecture

## Executive Summary

**watch-claude-think** is a real-time CLI tool that monitors Claude Code sessions and displays both internal reasoning (thinking blocks) and user messages. It reads Claude Code's session files from `~/.claude/projects/`, parses JSONL message streams, and renders them in a terminal UI.

**Key Innovation**: Custom terminal rendering pipeline that bypasses React/Ink's reconciliation to achieve 10K+ message display with instant resize and minimal memory overhead.

**Critical Constraints**:
- Must handle thousands of messages efficiently
- Terminal resize must not create visual artifacts
- Real-time file watching across multiple sessions
- Support complex conversation branching

**Trade-offs Made**:
- Performance over framework idioms (custom rendering vs React)
- Memory over persistence (in-memory store)
- Simplicity over features (no database, no pagination)

## System Design

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     CLI Entry (cli.tsx)                      │
└──────────────────────┬──────────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    App Navigation State                      │
│         (loading → select-project → watching)                │
└──────────────┬─────────────────────┬────────────────────────┘
               ▼                     ▼
┌──────────────────────┐  ┌───────────────────────────────────┐
│  Interactive Selectors│  │        StreamView                 │
│  (React/Ink Components)│  │    (Custom Rendering Pipeline)   │
└──────────────────────┘  └──────────┬────────────────────────┘
                                     ▼
┌─────────────────────────────────────────────────────────────┐
│                   Service Layer                              │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │SessionManager│ │MessageStore  │ │SessionWatcher│        │
│  └──────────────┘ └──────────────┘ └──────────────┘        │
└──────────────────────────┬──────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Data Layer                                │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │ File System  │ │    Parser    │ │   Watcher    │        │
│  │  Discovery   │ │    (JSONL)   │ │  (chokidar)  │        │
│  └──────────────┘ └──────────────┘ └──────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

### Core Components

1. **UI Layer**: React/Ink for navigation, custom rendering for messages
2. **Service Layer**: Coordinates file watching, message parsing, and storage
3. **Data Layer**: File system operations, JSONL parsing, real-time monitoring

### Key Design Decisions

- **Hybrid Rendering**: Ink for interactive components, custom for message display
- **Streaming Architecture**: Parse files incrementally, display immediately
- **Event-Driven Updates**: File changes trigger parsing → storage → rendering
- **Stateless Parsing**: Each parse operation is independent, enabling parallelism

## Technical Strategy

### Why Custom Rendering Over React/Ink

**Problem**: Ink's `<Static>` component creates "ghost lines" on terminal resize.

When terminal width changes, text reflows to different line counts. Static doesn't track what it previously rendered, leaving duplicate content visible. After trying multiple workarounds (force re-renders, manual cleanup, virtualization), we adopted a custom approach.

**Solution**: Accumulate messages as a string, clear and redraw on resize.

```typescript
// Simplified mental model
class CustomRenderLogger {
  fullOutput: string = '';  // All messages as ANSI string

  onResize() {
    clearTerminal();
    write(fullOutput);  // No ghosts possible
  }

  onNewMessage(msg) {
    fullOutput += renderToString(msg);
    write(msg);  // Incremental append
  }
}
```

### Why JSONL Over Database

**Claude Code's Choice**: Append-only JSONL files per session.

**Advantages**:
- **Crash-resistant**: Partial writes don't corrupt file
- **Streamable**: Parse new lines without reading entire file
- **Simple**: No database setup, migrations, or connections
- **Debuggable**: Human-readable format

**Trade-off**: No complex queries, but we only need chronological streaming.

### Why In-Memory Message Store

**Design**: Keep all messages in memory after initial load.

**Rationale**:
- Messages are immutable once displayed
- ~1KB per message (1000 messages ≈ 1MB)
- Enables instant rendering without file I/O
- Simplifies deduplication and sorting

**Constraint**: Initial load capped at 500 most recent blocks to bound memory.

### Three-Tier Data Model

```
Projects (directories) → Sessions (JSONL files) → Conversations (message chains)
```

- **Project**: Encoded directory path (e.g., `/Users/john/app` → `-Users-john-app`)
- **Session**: One Claude invocation, one UUID, one file
- **Conversation**: Branch from root to leaf message (supports retries/edits)

## Performance Profile

### Proven Scale

- **10,000+ messages**: Resize in ~100ms (imperceptible)
- **Memory usage**: ~1KB/message for string accumulation
- **Initial load**: 500 recent blocks in ~50-200ms
- **New message**: O(1) append + footer redraw (~1-2ms)
- **File watching**: Incremental parse ~1-5ms per change

### Bottlenecks and Mitigations

| Bottleneck | Impact | Mitigation |
|------------|--------|------------|
| Initial conversation discovery | ~500ms for 20 sessions | Parse files in parallel |
| Memory growth | Unbounded with long sessions | Cap initial load to 500 blocks |
| Terminal buffer | Large redraws can flicker | Synchronized update sequences |
| File I/O on changes | Potential for missed updates | Position tracking with LRU cache |

### Resource Model

```
Memory = Initial Load (500KB) + New Messages (1KB each) + Overhead (~1MB)
CPU = Parsing (minimal) + Rendering (string ops) + File watching (OS events)
I/O = Initial discovery + Incremental reads (position-based)
```

## Data Architecture

### JSONL Format

Each line is a complete JSON object, enabling:
- Append-only writes (Claude Code)
- Streaming reads (watch-claude-think)
- Partial file recovery after crashes

### Message Types

```typescript
// What we parse from files
type JSONLEntry =
  | ClaudeMessageEntry    // User/assistant messages with thinking
  | SummaryEntry         // Conversation names
  | FileHistorySnapshot  // File state tracking
  | SystemEntry;         // Errors, boundaries

// What we display
type DisplayMessage =
  | ThinkingBlock  // Extracted from assistant messages
  | UserMessage;   // Filtered for actual user input
```

### Message Filtering Strategy

**System messages filtered**:
- Tool outputs with `<system-reminder>`
- Command feedback (`<command-*>`)
- Meta messages (`isMeta: true`)

**Thinking extraction**:
- Parse assistant `content` array
- Extract `type: 'thinking'` blocks
- Display as separate `ThinkingBlock` entries

### Conversation Branching

Messages form a tree via `parentUuid` links:

```
msg1 (root) → msg2 → msg3a (leaf A, conversation 1)
                  └→ msg3b → msg4b (leaf B, conversation 2)
```

**Leaf detection**: Find messages not referenced as anyone's parent.

## Operational Considerations

### Known Limitations

- **Memory growth**: No eviction for long-running sessions
- **Large projects**: Conversation discovery reads all files
- **Branch complexity**: UI shows leaves, not full tree
- **Platform-specific**: Assumes Unix-like paths

### Failure Modes

| Failure | Behavior | Recovery |
|---------|----------|----------|
| Corrupt JSONL | Skip malformed lines | Continue parsing valid lines |
| Missing session file | Empty conversation list | Refresh on next file event |
| Terminal too small | Truncate output | Restore on resize |
| Permission denied | Error in selector | User must fix permissions |

### Critical Dependencies

- **File system access**: Read access to `~/.claude/projects/`
- **Node.js 18+**: ESM modules, modern APIs
- **Terminal**: ANSI escape sequence support
- **Claude Code**: Active sessions generating JSONL files

## Key Workflows

### Startup Flow

1. **Discovery**: List projects from `~/.claude/projects/`
2. **Selection**: User picks project → list conversations
3. **Initialization**: Parse session files (last 500KB each)
4. **Rendering**: Display messages in custom pipeline

### Real-Time Streaming

1. **File change detected** (chokidar)
2. **Parse new lines** (from last position)
3. **Filter and extract** (thinking blocks, user messages)
4. **Store and deduplicate** (in-memory)
5. **Render incrementally** (append to string)

### Terminal Resize

1. **Detect dimension change**
2. **Clear entire terminal**
3. **Rewrite accumulated string**
4. **Render footer at new width**
5. **Wrap in synchronized update** (prevent flicker)

## References

### Architecture Decision Records

- [ADR-001: Custom Terminal Rendering](./docs/adr/001-custom-terminal-rendering.md)
- [ADR-002: Static vs Dynamic Output](./docs/adr/002-static-dynamic-output.md)
- [ADR-003: JSONL Structure](./docs/adr/003-jsonl-structure.md)
- [ADR-006: Sessions vs Conversations](./docs/adr/006-sessions-vs-conversations.md)

### Documentation

- [Technical Guide](./TECHNICAL_GUIDE.md) - Implementation details
- [README](./README.md) - User documentation

### Key Source Files

- `src/lib/custom-logger.ts` - Custom rendering pipeline
- `src/lib/parser.ts` - JSONL parsing and extraction
- `src/services/session-manager.ts` - File watching coordination
- `src/components/StreamView.tsx` - Rendering orchestration