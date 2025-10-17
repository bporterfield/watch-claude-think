# Technical Guide

> Implementation details and developer reference for watch-claude-think

## Overview

Implementation details for developers working on watch-claude-think. For architecture decisions, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Technologies

### Core Stack

- **Language**: TypeScript (ES2022 target, ESM modules)
- **UI Framework**: React 19 + Ink 6 (React for terminal UIs)
- **Runtime**: Node.js 18+
- **Package Manager**: npm
- **Build Tool**: TypeScript compiler + tsdown (for production bundling)

### Key Dependencies

- **chokidar** (^4.0.3) - File system watching
- **chalk** (^5.6.2) - Terminal color styling
- **marked** + **marked-terminal** - Markdown rendering
- **p-queue** (^9.0.0) - Queue management for async operations
- **strip-ansi** (^7.1.0) - ANSI escape code handling

### Development Tools

- **vitest** - Testing framework (unit, integration, e2e)
- **eslint** + **prettier** - Code quality and formatting
- **tsx** - TypeScript execution for development

## System Components

### 1. CLI & UI Layer

**Location**: `src/cli.tsx`, `src/components/`

#### Entry Point (`cli.tsx`)

- Displays ASCII art banner
- Renders React app via Ink
- Error boundary for crash handling

#### Main App (`App.tsx`)

Navigation state machine:

1. **loading** - Initialize project discovery
2. **select-project** - User picks project from list
3. **select-conversation** - User picks conversation(s) to watch
4. **watching** - Stream view displays messages

**Navigation Stack**: Maintains history for back button (ESC key)

#### UI Components

- **ProjectSelector** (`ProjectSelector.tsx`) - Interactive project list
- **SessionSelector** (`SessionSelector.tsx`) - Interactive conversation list
- **StreamView** (`StreamView.tsx`) - Message display (custom rendering)
- **ErrorBoundary** (`ErrorBoundary.tsx`) - Error handling wrapper

**Color System** (`colors.ts`):
- Project colors: Consistent hash-based colors per project
- Session colors: Unique colors per session (excluding project color)
- Uses Chalk for ANSI color codes

### 2. Custom Terminal Rendering Pipeline

**Location**: `src/lib/custom-logger.ts`, `src/lib/terminal-ops.ts`, `src/hooks/useCustomRenderer.ts`

#### CustomRenderLogger (`custom-logger.ts`)

- Accumulates static content (messages) as plain string
- Tracks dynamic content (footer) for clearing/updating
- Generates terminal operations for each render frame
- Full redraw on resize to eliminate ghost lines

#### Terminal Operations (`terminal-ops.ts`)

```typescript
type TerminalOperation =
  | { type: 'stdout'; content: string; scrollback: boolean }
  | { type: 'clear'; count: number }
  | { type: 'clearTerminal' }
  | { type: 'synchronizedUpdateStart' }
  | { type: 'synchronizedUpdateEnd' };
```

#### Rendering Strategy

- **Static content** (messages): Written to scrollback buffer, permanent
- **Dynamic content** (footer): Written without scrollback, ephemeral
- **Resize**: Clear terminal, rewrite accumulated string
- **Normal update**: Clear footer, append new message, rewrite footer

#### Performance Characteristics

- **10,000+ messages**: ~100ms resize (instant feel)
- **Memory**: ~1KB per message (string) vs ~5KB (React component)
- **New message**: O(1) string append + footer rewrite

### 3. File System Layer

**Location**: `src/lib/file-system.ts`

#### Key Functions

**listProjects()**: Discover all projects
- Read `~/.claude/projects/` directory
- Extract `cwd` from recent session files (encoding not reversible)
- Detect git worktrees and group by common `.git` directory
- Returns `ProjectInfo[]` sorted by modification time

**listSessions()**: List sessions in a project
- Read all `.jsonl` files in project directory
- Filter out compacted sessions (resumed elsewhere)
- Extract session info (names, timestamps)
- Returns `SessionInfo[]`

**listConversations()**: List conversations in a project
- Parse all session files
- Build global summary map (cross-file)
- Find leaf messages (no children)
- Match summaries to leaves
- Returns `ConversationInfo[]`

#### Data Structures

```typescript
interface ProjectInfo {
  name: string;          // Display name (from cwd)
  path: string;          // Directory path
  cwd: string | null;    // Working directory
  mtime: Date;           // Most recent activity
}

interface SessionInfo {
  id: string;            // Filename without .jsonl
  name: string;          // Summary or first user message
  path: string;          // Absolute file path
  mtime: Date;           // File modification time
}

interface ConversationInfo {
  id: string;            // `${sessionId}-${leafUuid}`
  name: string;          // Summary or fallback
  sessionPath: string;   // Path to .jsonl file
  sessionId: string;     // Session file id
  leafUuid: string;      // Leaf message UUID
  mtime: Date;           // Last message timestamp
}
```

### 4. File Watching System

**Location**: `src/lib/session-watcher.ts`, `src/services/session-manager.ts`

#### SessionWatcher (`session-watcher.ts`)

Low-level file watching using chokidar:

- **Directory watching**: Monitors project directory for new sessions
- **File watching**: Tracks specific session files for changes
- **Callbacks**: `onChange(filePath)`, `onNewSession(filePath)`

**Why directory watching**: More reliable than watching individual files (handles file recreation, atomic writes)

#### SessionManager (`session-manager.ts`)

High-level session management:

- **Initialization**: Parse existing content (capped to `MAX_BLOCKS_INITAL_RENDER`)
- **Change handling**: Parse new lines incrementally
- **New session detection**: Register and parse newly created sessions
- **Session naming**: Update names when summaries or user messages appear
- **Event emission**: Notify listeners of new messages

**File Position Tracking**:
- LRU cache tracks last read position per file
- Enables incremental parsing (read only new lines)
- Limited size prevents unbounded memory growth

### 5. Message Parsing & Processing

**Location**: `src/lib/parser.ts`

#### Parsing Functions

**parseNewLines(filePath)**: Incremental parsing
- Read from last known position (file position cache)
- Parse only new content
- Update position for next read
- Returns `MessageBlock[]`

**parseFileTail(filePath, maxBytes)**: Efficient initial load
- Read last N bytes (default: 500KB)
- Skip first line (may be incomplete)
- Parse remaining lines
- Returns `MessageBlock[]`

**extractSessionInfo(filePath)**: Session metadata extraction
- Read file once, extracting multiple pieces of info:
  - Summary entries (at top of file)
  - First user message (for fallback name)
  - CWD (working directory)
  - Orphan detection (summary linked to messages?)
- Returns session name, cwd, summary metadata

**extractSummariesAndConversations(filePath)**: Conversation discovery
- Single-pass extraction for efficiency
- Collect all summaries and messages
- Find leaf messages (no children)
- Build conversation branches
- Returns summaries + conversations

#### Message Filtering

**System message detection**: Filters out non-user content
- `isMeta` flag (Caveat messages)
- `toolUseResult` field (tool output with `<system-reminder>`)
- Content patterns (`<command-*>`, `<local-command-*>`)

**Thinking extraction**: Extract from assistant message `content` array
- Filter for `type: 'thinking'` blocks
- Create separate `ThinkingBlock` for each
- Preserve message UUID and index

### 6. Message Storage

**Location**: `src/services/message-store.ts`

#### MessageStore

**State**:
- `blocks: DisplayMessageBlock[]` - All messages (chronological)
- `blockKeys: Set<string>` - Deduplication keys
- `listeners: Set<callback>` - Change subscribers

**Operations**:
- **addBlocks()**: Add new messages with deduplication
  - Fast path: Append if all newer than last
  - Slow path: Merge and re-sort (for clock drift)
- **clear()**: Remove all messages
- **subscribe()**: Register change listener

**Deduplication Key**:
```typescript
`${block.sessionId}-${block.messageId}-${block.type}-${block.thinkingIndex || 0}`;
```

**No Eviction**: Keeps all messages in memory. Initial load is capped by `SessionManager` at `MAX_BLOCKS_INITAL_RENDER` (500).

### 7. Service Coordination

**Location**: `src/hooks/useSessionServices.ts`

Custom hook that wires together `SessionManager` and `MessageStore`:

- Initialize SessionManager with session files
- Create MessageStore for deduplication
- Subscribe to SessionManager events
- Add new messages to MessageStore
- Notify renderer on changes
- Cleanup on unmount

## Implementation Details

### Message Display Flow

1. **Initialization** (`useSessionServices.ts`)
   - Create `SessionManager` with session files
   - Parse existing content (tail of files, capped to 500 blocks)
   - Sort by timestamp
   - Add to `MessageStore`
   - Render initial messages

2. **Real-time Updates** (`SessionManager` → `MessageStore` → `CustomRenderLogger`)
   - `SessionWatcher` detects file change
   - `SessionManager` parses new lines incrementally
   - Filter/deduplicate in `MessageStore`
   - Emit change event
   - `useCustomRenderer` converts to strings
   - `CustomRenderLogger` generates terminal operations
   - Write to stdout

3. **Rendering Pipeline** (`useCustomRenderer.ts` → `custom-logger.ts`)
   - Convert message blocks to ANSI strings (`block-renderer.ts`)
   - Render footer to string (`footer-renderer.ts`)
   - Create `RenderFrame` (static + dynamic output)
   - Pass to `CustomRenderLogger.render()`
   - Execute terminal operations

### Terminal Resize Flow

1. **Resize Detection** (`useTerminalResize.ts`)
   - Listen to `process.stdout` resize events
   - Debounce to avoid excessive redraws

2. **Full Redraw** (`CustomRenderLogger`)
   - Detect dimensions changed
   - Clear terminal
   - Rewrite accumulated static string (all messages)
   - Render footer at new width
   - Wrap in synchronized update (prevent flicker)

### JSONL File Structure

Claude Code's session files use JSONL (JSON Lines) format where each line is a complete JSON object:

```jsonl
{"type":"summary","uuid":"abc123","name":"Feature Implementation"}
{"type":"message","role":"user","content":"Build a new feature","uuid":"def456"}
{"type":"message","role":"assistant","content":[{"type":"thinking","text":"Let me plan this..."}],"uuid":"ghi789","parentUuid":"def456"}
```

- One JSON object per line
- Append-only for crash resistance
- Streamable for incremental parsing

### Performance Optimization Techniques

#### Memory Management

- **Initial load capping**: Read only last 500KB of each file
- **String accumulation**: Messages stored as rendered strings, not components
- **LRU file position cache**: Bounded at 100 entries

#### I/O Optimization

- **Parallel file reads**: During discovery phase
- **Incremental parsing**: Track position, read only new lines
- **Tail reading**: Start from end of file for recent messages

#### Rendering Optimization

- **String concatenation**: O(1) append for new messages
- **Batch updates**: Debounced resize handling
- **Synchronized updates**: Prevent terminal flicker

## Testing Strategy

**Location**: `test/`

### Test Types

#### Unit Tests (`test/unit/`)

- `parser.test.ts` - JSONL parsing, message extraction
- `file-system.test.ts` - Project/session/conversation discovery
- `message-store.test.ts` - Deduplication, sorting
- `colors.test.ts` - Color assignment consistency
- `conversation-discovery.test.ts` - Branch detection, summary matching

#### Integration Tests (`test/integration/`)

- `file-watching.test.ts` - SessionWatcher + SessionManager integration
- `session-lifecycle.test.ts` - Full session management lifecycle
- `worktree-detection.test.ts` - Git worktree grouping

#### E2E Tests (`test/e2e/`)

- `workflow.e2e.test.ts` - Full user workflow simulation

### Test Utilities

**Fixtures** (`test/fixtures/`):
- Realistic project structures
- Sample session files
- Various conversation branching scenarios

**Test Helpers**:
- File system mocking
- Temporary directory creation
- Session file generation

## Performance Characteristics

### Memory Usage

- **Initial load**: Capped to 500 most recent blocks (~500KB)
- **Ongoing**: All new messages kept in memory (~1KB each)
- **File positions**: LRU cache of 100 entries (~10KB)
- **String accumulation**: Full static output (~1KB per message)

**Example session**:
- 500 initial blocks = ~500KB
- 1000 additional blocks = ~1MB
- Total: ~2MB for 1500 messages

### File I/O

**Project listing**:
- Read 10 most recent session files (first 20 lines each)
- Parallel reads for CWD extraction
- ~10ms per project

**Conversation listing**:
- Parse all session files in project
- Build global summary map
- O(S × M) where S = sessions, M = messages per session
- ~100-500ms for 10-20 sessions

**Initial message load**:
- Read tail of each session (default: 500KB)
- Parse incrementally
- ~50-200ms for multiple sessions

**Incremental updates**:
- Read only new lines (tracked by file position)
- ~1-5ms per file change

### Rendering Performance

**Initial render**:
- Convert 500 blocks to ANSI strings
- ~50-100ms

**New message**:
- Convert 1 block to ANSI string
- Clear footer (2-3 lines)
- Write message + footer
- ~1-2ms (imperceptible)

**Terminal resize**:
- Clear terminal
- Write accumulated string (~500KB-1MB)
- Render footer at new width
- ~100ms for 10,000 messages (instant feel)

## Common Patterns

### Error Handling

```typescript
// Graceful degradation for file operations
try {
  const content = await fs.readFile(path, 'utf-8');
  return parseContent(content);
} catch (error) {
  console.error(`Failed to read ${path}:`, error);
  return []; // Return empty array, continue operation
}
```

### Async Operations

```typescript
// Use p-queue for controlled parallelism
const queue = new Queue({ concurrency: 5 });

const results = await Promise.all(
  files.map(file =>
    queue.add(() => parseFile(file))
  )
);
```

### State Management

```typescript
// Event-driven updates with listeners
class Store {
  private listeners = new Set<() => void>();

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach(l => l());
  }
}
```

### Terminal Output

```typescript
// Always use synchronized updates for flicker-free rendering
const operations = [
  { type: 'synchronizedUpdateStart' },
  ...contentOperations,
  { type: 'synchronizedUpdateEnd' }
];
```

## Debugging Tips

### Common Issues

**Ghost lines on resize**:
- Ensure CustomRenderLogger is doing full redraw
- Check terminal dimensions are being tracked correctly

**Messages not appearing**:
- Verify file watcher is active (check SessionWatcher events)
- Check message filtering logic in parser
- Ensure deduplication keys are unique

**Performance degradation**:
- Check message count in MessageStore
- Verify initial load is capped
- Profile string accumulation in CustomRenderLogger

### Debug Commands

```bash
# Check Claude Code sessions
ls -la ~/.claude/projects/*/

# Monitor file changes
watch -n 1 "tail -n 5 ~/.claude/projects/*/*.jsonl"

# Test parsing
node -e "console.log(require('./dist/lib/parser.js').parseFileTail('path/to/session.jsonl'))"
```

### Logging

Enable debug output with environment variables:

```bash
# Debug file watching
DEBUG=watcher npm run dev

# Debug parsing
DEBUG=parser npm run dev

# Debug rendering
DEBUG=render npm run dev
```

## Contributing

### Workflow

1. **Setup**:
   ```bash
   npm install
   npm run build
   ```

2. **Development**:
   ```bash
   npm run dev  # Run with tsx for hot reload
   ```

3. **Testing**:
   ```bash
   npm test          # Run all tests
   npm run test:unit # Unit tests only
   npm run test:e2e  # E2E tests only
   ```

4. **Quality Checks**:
   ```bash
   npm run check     # TypeScript + Lint
   npm run format    # Format code
   ```

### Code Standards

- **TypeScript**: Strict mode, no `any` without explicit justification
- **Testing**: Write tests for new features
- **Comments**: Document "why" not "what"
- **Commits**: Clear messages referencing issues/features

### Architecture Principles

- **Performance first**: This tool monitors real-time streams
- **Fail gracefully**: Never crash on bad input
- **User experience**: Instant feedback, no lag
- **Maintainability**: Clear separation of concerns

## References

### Architecture Decision Records

- [ADR-001: Custom Terminal Rendering](./docs/adr/001-custom-terminal-rendering.md)
- [ADR-002: Static vs Dynamic Output](./docs/adr/002-static-dynamic-output.md)
- [ADR-003: JSONL Structure](./docs/adr/003-jsonl-structure.md)
- [ADR-004: CWD Derivation](./docs/adr/004-cwd-derivation.md)
- [ADR-005: Worktree Detection](./docs/adr/005-worktree-detection.md)
- [ADR-006: Sessions vs Conversations](./docs/adr/006-sessions-vs-conversations.md)
- [ADR-007: Summary Handling](./docs/adr/007-summary-handling.md)

### Key Source Files

**Entry Points**:
- `src/cli.tsx` - CLI entry point
- `src/components/App.tsx` - Main application

**Core Systems**:
- `src/lib/custom-logger.ts` - Custom rendering pipeline
- `src/lib/parser.ts` - JSONL parsing
- `src/lib/file-system.ts` - Project/session/conversation discovery
- `src/services/session-manager.ts` - File watching coordination
- `src/services/message-store.ts` - Message storage and deduplication

**Rendering**:
- `src/lib/terminal-ops.ts` - Terminal operation primitives
- `src/lib/block-renderer.ts` - Message → ANSI string conversion
- `src/lib/footer-renderer.ts` - Footer rendering
- `src/hooks/useCustomRenderer.ts` - Rendering orchestration

**Data Types**:
- `src/types/claude-message.ts` - Claude Code message types
