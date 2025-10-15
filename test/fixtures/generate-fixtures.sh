#!/bin/bash

# Script to generate realistic test fixtures using Claude CLI
# This creates actual Claude sessions that can be copied to test/fixtures/sessions/

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SESSIONS_DIR="$SCRIPT_DIR/sessions"

echo "Generating test fixtures using Claude CLI..."
echo "Note: This will create temporary Claude sessions"
echo ""

# Function to generate a session with a specific UUID
generate_session() {
  local session_id="$1"
  local prompt="$2"
  local output_file="$3"

  echo "Generating session: $session_id"
  echo "  Prompt: $prompt"

  # Create a session with predictable UUID
  claude --print --session-id "$session_id" "$prompt" > /dev/null 2>&1 || true

  # Find the session file in ~/.claude/projects/
  local session_file=$(find ~/.claude/projects/ -name "${session_id}.jsonl" 2>/dev/null | head -1)

  if [ -f "$session_file" ]; then
    # Copy to fixtures directory with custom name
    cp "$session_file" "$SESSIONS_DIR/$output_file"
    echo "  ✓ Created: $output_file"

    # Optionally clean up the session from Claude's storage
    # rm "$session_file"
  else
    echo "  ✗ Failed to find session file"
  fi

  echo ""
}

# Generate different types of sessions

# 1. Simple question/answer session
generate_session \
  "test-fixture-simple-001" \
  "What is 2+2?" \
  "generated-simple.jsonl"

# 2. Code explanation session (should have thinking blocks)
generate_session \
  "test-fixture-code-002" \
  "Explain how async/await works in JavaScript" \
  "generated-code-explanation.jsonl"

# 3. Multi-turn conversation
generate_session \
  "test-fixture-multi-003" \
  "Can you help me write a function that reverses a string?" \
  "generated-multi-turn.jsonl"

echo "Fixture generation complete!"
echo ""
echo "Generated fixtures are in: $SESSIONS_DIR"
echo ""
echo "Note: These are real Claude sessions. Review them before committing."
echo "You may want to:"
echo "  1. Inspect the files to ensure they have the expected structure"
echo "  2. Truncate or modify them for specific test cases"
echo "  3. Remove any sensitive information if present"
echo ""
echo "To clean up the source sessions from your ~/.claude/projects/, run:"
echo "  find ~/.claude/projects/ -name 'test-fixture-*.jsonl' -delete"
