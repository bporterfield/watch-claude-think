# Test Fixtures

This directory contains test fixtures for the watch-claude-think test suite.

## Directory Structure

```
fixtures/
├── sessions/          # JSONL session files for testing
│   ├── simple-session.jsonl
│   ├── compacted-session.jsonl
│   ├── multi-thinking.jsonl
│   ├── system-messages.jsonl
│   └── empty-session.jsonl
├── generate-fixtures.sh  # Script to generate fixtures using Claude CLI
└── README.md
```

## Available Fixtures

### Static Fixtures (Hand-crafted)

These are minimal, predictable fixtures for unit tests:

- **simple-session.jsonl** - Basic user message + single thinking block
- **compacted-session.jsonl** - Session with summary entry (compacted/archived)
- **multi-thinking.jsonl** - Multiple thinking blocks in one response
- **system-messages.jsonl** - Contains system messages that should be filtered
- **empty-session.jsonl** - Only contains initial snapshot, no messages

### Generated Fixtures (Real Claude Sessions)

Use `generate-fixtures.sh` to create real Claude sessions for integration testing:

```bash
./test/fixtures/generate-fixtures.sh
```

This will:
1. Create Claude sessions with predictable UUIDs
2. Copy them to the `sessions/` directory
3. Name them with a `generated-` prefix

**Note**: Review generated fixtures before committing them to ensure:
- No sensitive information
- Appropriate size for tests
- Expected structure

## Using Fixtures in Tests

```typescript
import { FIXTURES, copyFixture } from "../helpers/fixtures.js";
import { createTestProject } from "../helpers/temp-dir.js";

// Copy a fixture to a test project
await copyFixture(
  FIXTURES.SIMPLE,
  path.join(projectPath, "test-session.jsonl")
);
```

## Fixture Structure

All JSONL session files follow this structure:

```jsonl
{"type":"file-history-snapshot",...}
{"type":"user","message":{...},"uuid":"...","timestamp":"..."}
{"type":"assistant","message":{"content":[{"type":"thinking",...},{"type":"text",...}]},...}
```

### Compacted Sessions

Compacted sessions have a summary entry as the first line:

```jsonl
{"type":"summary","summary":"Session Name","leafUuid":"last-message-uuid"}
{"type":"user",...}
{"type":"assistant",...}
```

## Maintenance

When updating fixtures:
1. Ensure backward compatibility with existing tests
2. Update this README if adding new fixtures
3. Run tests to verify fixtures work as expected: `npm test`
