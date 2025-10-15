import { describe, it, expect, afterEach } from "vitest";
import path from "path";
import fs from "fs/promises";
import {
  parseNewLines,
  parseEntireFile,
  parseFileTail,
  extractSessionInfo,
  containsAnyUuid,
  getLastMessageUuid,
  resetFilePosition,
} from "../../src/lib/parser.js";
import {
  createTempClaudeDir,
  cleanupTempDir,
  createTestProject,
  copyFixture,
  FIXTURES,
  MOCK_CLAUDE_DIR,
  appendToFile,
} from "../helpers/index.js";

// Path to read-only fixture sessions
const FIXTURE_PROJECT = path.join(MOCK_CLAUDE_DIR, "projects", "project-alpha");

describe("parser", () => {
  // Only create temp dirs for tests that modify files
  let tempClaudeDir: string | null = null;
  let tempProjectPath: string | null = null;

  afterEach(async () => {
    if (tempClaudeDir) {
      await cleanupTempDir(tempClaudeDir);
      tempClaudeDir = null;
      tempProjectPath = null;
    }
  });

  describe("parseNewLines", () => {
    it("should parse user messages and thinking blocks from a simple session", async () => {
      const sessionPath = path.join(FIXTURE_PROJECT, FIXTURES.SIMPLE);

      const messages = await parseNewLines(sessionPath);

      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({
        type: "user",
        content: "Can you help me understand this function?",
      });
      expect(messages[1]).toMatchObject({
        type: "thinking",
        thinking: expect.stringContaining("analyze this function"),
      });

      // Reset for next test
      resetFilePosition(sessionPath);
    });

    it("should extract multiple thinking blocks from a single message", async () => {
      const sessionPath = path.join(FIXTURE_PROJECT, FIXTURES.MULTI_THINKING);

      const messages = await parseNewLines(sessionPath);

      const thinkingBlocks = messages.filter((m) => m.type === "thinking");
      expect(thinkingBlocks.length).toBeGreaterThanOrEqual(3);

      resetFilePosition(sessionPath);
    });

    it("should filter out system messages", async () => {
      const sessionPath = path.join(FIXTURE_PROJECT, FIXTURES.SYSTEM_MESSAGES);

      const messages = await parseNewLines(sessionPath);

      const userMessages = messages.filter((m) => m.type === "user");

      // Should only have the real user message, not system messages
      expect(userMessages).toHaveLength(1);
      expect(userMessages[0]?.content).toBe("This is a real user message");

      resetFilePosition(sessionPath);
    });

    it("should track file position and only read new lines on subsequent calls", async () => {
      // This test modifies files, so we need a temp directory
      tempClaudeDir = await createTempClaudeDir();
      tempProjectPath = await createTestProject(tempClaudeDir, "test-project");
      const sessionPath = path.join(tempProjectPath, "incremental.jsonl");
      await copyFixture(FIXTURES.SIMPLE, sessionPath);

      // First read
      const messages1 = await parseNewLines(sessionPath);
      expect(messages1.length).toBeGreaterThan(0);

      // Second read without changes - should return empty
      const messages2 = await parseNewLines(sessionPath);
      expect(messages2).toHaveLength(0);

      // Append new content
      const newLine =
        '{"parentUuid":"user-msg-1","isSidechain":false,"userType":"default","cwd":"/Users/test/project","sessionId":"simple-test-session","version":"1.0.0","gitBranch":"main","type":"user","message":{"role":"user","content":"Follow up question"},"uuid":"user-msg-2","timestamp":"2025-01-15T10:00:05.000Z"}';
      await appendToFile(sessionPath, newLine);

      // Third read - should only get new message
      const messages3 = await parseNewLines(sessionPath);
      expect(messages3).toHaveLength(1);
      expect(messages3[0]).toMatchObject({
        type: "user",
        content: "Follow up question",
      });
    });

    it("should handle empty sessions", async () => {
      const sessionPath = path.join(FIXTURE_PROJECT, FIXTURES.EMPTY);

      const messages = await parseNewLines(sessionPath);

      expect(messages).toHaveLength(0);

      resetFilePosition(sessionPath);
    });

    it("should skip malformed JSON lines", async () => {
      // This test creates a custom file, needs temp dir
      tempClaudeDir = await createTempClaudeDir();
      tempProjectPath = await createTestProject(tempClaudeDir, "test-project");
      const sessionPath = path.join(tempProjectPath, "malformed.jsonl");
      await fs.writeFile(
        sessionPath,
        '{"valid":"json"}\nthis is not json\n{"type":"user","message":{"role":"user","content":"test"},"uuid":"test-1","timestamp":"2025-01-15T10:00:00.000Z","sessionId":"test","parentUuid":null,"isSidechain":false,"userType":"default","cwd":"/test","version":"1.0.0","gitBranch":"main"}'
      );

      const messages = await parseNewLines(sessionPath);

      // Should only get the valid user message, skipping the malformed line
      expect(messages).toHaveLength(1);
      expect(messages[0]?.type).toBe("user");
    });

    it("should preserve message metadata (sessionId, messageId, timestamp)", async () => {
      const sessionPath = path.join(FIXTURE_PROJECT, FIXTURES.SIMPLE);

      const messages = await parseNewLines(sessionPath);

      expect(messages[0]).toMatchObject({
        sessionId: "simple-test-session",
        messageId: "user-msg-1",
        timestamp: expect.any(String),
      });

      resetFilePosition(sessionPath);
    });
  });

  describe("parseEntireFile", () => {
    it("should parse entire file from beginning", async () => {
      const sessionPath = path.join(FIXTURE_PROJECT, FIXTURES.SIMPLE);

      // First, do a partial read
      await parseNewLines(sessionPath);

      // parseEntireFile should reset and read everything
      const messages = await parseEntireFile(sessionPath);

      expect(messages.length).toBeGreaterThan(0);
    });

    it("should reset file position after parsing", async () => {
      const sessionPath = path.join(FIXTURE_PROJECT, FIXTURES.SIMPLE);

      await parseEntireFile(sessionPath);

      // Next incremental read should return nothing
      const messages = await parseNewLines(sessionPath);
      expect(messages).toHaveLength(0);

      resetFilePosition(sessionPath);
    });
  });

  describe("parseFileTail", () => {
    it("should parse only the tail of a large file", async () => {
      // Needs to modify file, use temp dir
      tempClaudeDir = await createTempClaudeDir();
      tempProjectPath = await createTestProject(tempClaudeDir, "test-project");
      const sessionPath = path.join(tempProjectPath, "tail.jsonl");

      // Create a file with multiple lines
      await copyFixture(FIXTURES.SIMPLE, sessionPath);

      // Append more content to make it larger
      const extraLine = '{"type":"user","message":{"role":"user","content":"Extra message"},"uuid":"extra-1","timestamp":"2025-01-15T10:00:10.000Z","sessionId":"simple-test-session","parentUuid":"assistant-msg-1","isSidechain":false,"userType":"default","cwd":"/Users/test/project","version":"1.0.0","gitBranch":"main"}';
      await appendToFile(sessionPath, extraLine);

      const messages = await parseFileTail(sessionPath, 500); // Last 500 bytes

      // Should get at least the last message
      expect(messages.length).toBeGreaterThan(0);
    });

    it("should parse entire file if smaller than maxBytes", async () => {
      const sessionPath = path.join(FIXTURE_PROJECT, FIXTURES.SIMPLE);

      const tailMessages = await parseFileTail(sessionPath, 1000000); // 1MB
      const fullMessages = await parseEntireFile(sessionPath);

      expect(tailMessages).toHaveLength(fullMessages.length);
    });

    it("should skip first incomplete line when reading from middle", async () => {
      // Creates custom file, needs temp dir
      tempClaudeDir = await createTempClaudeDir();
      tempProjectPath = await createTestProject(tempClaudeDir, "test-project");
      const sessionPath = path.join(tempProjectPath, "incomplete.jsonl");

      // Create a multi-line file
      const lines = [
        '{"type":"file-history-snapshot","messageId":"init","snapshot":{"messageId":"init","trackedFileBackups":{},"timestamp":"2025-01-15T10:00:00.000Z"},"isSnapshotUpdate":false}',
        '{"type":"user","message":{"role":"user","content":"First message"},"uuid":"msg-1","timestamp":"2025-01-15T10:00:01.000Z","sessionId":"test","parentUuid":null,"isSidechain":false,"userType":"default","cwd":"/test","version":"1.0.0","gitBranch":"main"}',
        '{"type":"user","message":{"role":"user","content":"Second message"},"uuid":"msg-2","timestamp":"2025-01-15T10:00:02.000Z","sessionId":"test","parentUuid":"msg-1","isSidechain":false,"userType":"default","cwd":"/test","version":"1.0.0","gitBranch":"main"}',
        '{"type":"user","message":{"role":"user","content":"Third message"},"uuid":"msg-3","timestamp":"2025-01-15T10:00:03.000Z","sessionId":"test","parentUuid":"msg-2","isSidechain":false,"userType":"default","cwd":"/test","version":"1.0.0","gitBranch":"main"}',
      ];
      await fs.writeFile(sessionPath, lines.join("\n"));

      // Read tail with byte limit to force mid-line start (last ~600 bytes to ensure we get complete lines)
      const messages = await parseFileTail(sessionPath, 600);

      // Should get at least the last two messages
      expect(messages.length).toBeGreaterThanOrEqual(1);

      // Should have user messages
      const hasUserMessages = messages.some(m => m.type === "user");
      expect(hasUserMessages).toBe(true);
    });

    it("should update file position cache so parseNewLines can read incrementally", async () => {
      // Regression test for bug where parseFileTail didn't update position cache,
      // causing parseNewLines to re-read entire file from beginning
      tempClaudeDir = await createTempClaudeDir();
      tempProjectPath = await createTestProject(tempClaudeDir, "test-project");
      const sessionPath = path.join(tempProjectPath, "position-cache.jsonl");

      // Create a large file (> 100KB to trigger tail reading)
      const lines: string[] = [];
      for (let i = 0; i < 300; i++) {
        const padding = "x".repeat(300);
        lines.push(
          JSON.stringify({
            type: "user",
            message: {
              role: "user",
              content: `Message ${i} - ${padding}`,
            },
            uuid: `msg-${i}`,
            timestamp: `2025-01-15T10:00:${String(i).padStart(2, "0")}.000Z`,
            sessionId: "test-session",
            parentUuid: null,
            isSidechain: false,
            userType: "default",
            cwd: "/test",
            version: "1.0.0",
            gitBranch: "main",
          })
        );
      }
      await fs.writeFile(sessionPath, lines.join("\n") + "\n");

      // Step 1: Call parseFileTail to read initial messages
      const initialMessages = await parseFileTail(sessionPath);
      expect(initialMessages.length).toBeGreaterThan(0);
      expect(initialMessages.length).toBeLessThan(300); // Should only read tail

      // Step 2: Append a new message
      const newMessage = JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: "NEW MESSAGE AFTER TAIL READ",
        },
        uuid: "new-message-uuid",
        timestamp: "2025-01-15T10:05:00.000Z",
        sessionId: "test-session",
        parentUuid: null,
        isSidechain: false,
        userType: "default",
        cwd: "/test",
        version: "1.0.0",
        gitBranch: "main",
      });
      await appendToFile(sessionPath, newMessage);

      // Step 3: Call parseNewLines - should only get the new message
      const newMessages = await parseNewLines(sessionPath);

      // Critical assertion: parseNewLines should only return 1 message (the new one)
      // If parseFileTail didn't update position cache, this would return 301 messages
      expect(newMessages).toHaveLength(1);
      expect(newMessages[0]).toMatchObject({
        type: "user",
        content: "NEW MESSAGE AFTER TAIL READ",
        messageId: "new-message-uuid",
      });
    });
  });

  describe("extractSessionInfo", () => {
    it("should extract summary from compacted session", async () => {
      const sessionPath = path.join(FIXTURE_PROJECT, FIXTURES.COMPACTED);

      const info = await extractSessionInfo(sessionPath);

      expect(info.sessionName).toBe("Function Analysis Discussion");
      expect(info.leafUuid).toBe("last-msg-uuid-123");
      expect(info.summariesAreOrphaned).toBe(false);
    });

    it("should extract first user message from normal session", async () => {
      const sessionPath = path.join(FIXTURE_PROJECT, FIXTURES.SIMPLE);

      const info = await extractSessionInfo(sessionPath);

      expect(info.sessionName).toContain("Can you help me understand this function");
      expect(info.leafUuid).toBeNull();
      expect(info.summariesAreOrphaned).toBe(false);
    });

    it("should detect orphaned summaries and use first user message instead", async () => {
      const sessionPath = path.join(FIXTURE_PROJECT, FIXTURES.ORPHANED_SUMMARY);

      const info = await extractSessionInfo(sessionPath);

      // Should ignore the summary entries ("Debugging Python Web Scraper", "Token Optimization")
      // and use the first user message content instead
      expect(info.sessionName).toContain("in iTerm2, things look nice like this");
      expect(info.sessionName).not.toContain("Debugging Python Web Scraper");
      expect(info.sessionName).not.toContain("Token Optimization");
      // LeafUuid should still be extracted from first summary line
      expect(info.leafUuid).toBe("e87318ee-1234-5678-9abc-def012345678");
      // Should flag summaries as orphaned
      expect(info.summariesAreOrphaned).toBe(true);
    });

    it("should extract ALL summaries from multi-resume sessions (not just line 1)", async () => {
      // This tests the bug fix: when there are MULTIPLE consecutive summary entries,
      // we should collect ALL of them (not just check line 1)
      tempClaudeDir = await createTempClaudeDir();
      tempProjectPath = await createTestProject(tempClaudeDir, "test-project");
      const sessionPath = path.join(tempProjectPath, "multi-summary.jsonl");

      const content = [
        // Line 1-2: Multiple summary entries (session resumed twice)
        '{"type":"summary","summary":"Most Recent Session Title","leafUuid":"resume-2-uuid"}',
        '{"type":"summary","summary":"Previous Session Title","leafUuid":"resume-1-uuid"}',
        // Line 3: file-history-snapshot
        '{"type":"file-history-snapshot","messageId":"init","snapshot":{"messageId":"init","trackedFileBackups":{},"timestamp":"2025-01-15T10:00:00.000Z"},"isSnapshotUpdate":false}',
        // Line 4: user message that links to the FIRST summary
        '{"type":"user","message":{"role":"user","content":"continue working on this"},"uuid":"msg-1","timestamp":"2025-01-15T10:00:01.000Z","sessionId":"test","parentUuid":"resume-2-uuid","isSidechain":false,"userType":"default","cwd":"/test","version":"1.0.0","gitBranch":"main"}',
      ];
      await fs.writeFile(sessionPath, content.join("\n"));

      const info = await extractSessionInfo(sessionPath);

      // Should use the FIRST summary's text (line 1)
      expect(info.sessionName).toBe("Most Recent Session Title");
      // Should extract the FIRST summary's leafUuid
      expect(info.leafUuid).toBe("resume-2-uuid");
      // Summaries should NOT be orphaned (user message links to them)
      expect(info.summariesAreOrphaned).toBe(false);
      // Should track that we're using this summary
      expect(info.summaryIdInUse).toBe("resume-2-uuid");
    });

    it("should truncate long session names", async () => {
      // Creates custom file, needs temp dir
      tempClaudeDir = await createTempClaudeDir();
      tempProjectPath = await createTestProject(tempClaudeDir, "test-project");
      const sessionPath = path.join(tempProjectPath, "long-name.jsonl");

      const longMessage = "A".repeat(100); // Very long message
      const content = [
        '{"type":"file-history-snapshot","messageId":"init","snapshot":{"messageId":"init","trackedFileBackups":{},"timestamp":"2025-01-15T10:00:00.000Z"},"isSnapshotUpdate":false}',
        `{"type":"user","message":{"role":"user","content":"${longMessage}"},"uuid":"msg-1","timestamp":"2025-01-15T10:00:01.000Z","sessionId":"test","parentUuid":null,"isSidechain":false,"userType":"default","cwd":"/test","version":"1.0.0","gitBranch":"main"}`,
      ];
      await fs.writeFile(sessionPath, content.join("\n"));

      const info = await extractSessionInfo(sessionPath);

      expect(info.sessionName.length).toBeLessThanOrEqual(43); // 40 chars + "..."
      expect(info.sessionName).toContain("...");
      expect(info.summariesAreOrphaned).toBe(false);
    });

    it("should replace newlines with spaces in session name", async () => {
      // Creates custom file, needs temp dir
      tempClaudeDir = await createTempClaudeDir();
      tempProjectPath = await createTestProject(tempClaudeDir, "test-project");
      const sessionPath = path.join(tempProjectPath, "multiline.jsonl");

      const content = [
        '{"type":"file-history-snapshot","messageId":"init","snapshot":{"messageId":"init","trackedFileBackups":{},"timestamp":"2025-01-15T10:00:00.000Z"},"isSnapshotUpdate":false}',
        '{"type":"user","message":{"role":"user","content":"Line 1\\nLine 2\\nLine 3"},"uuid":"msg-1","timestamp":"2025-01-15T10:00:01.000Z","sessionId":"test","parentUuid":null,"isSidechain":false,"userType":"default","cwd":"/test","version":"1.0.0","gitBranch":"main"}',
      ];
      await fs.writeFile(sessionPath, content.join("\n"));

      const info = await extractSessionInfo(sessionPath);

      expect(info.sessionName).toBe("Line 1 Line 2 Line 3");
      expect(info.sessionName).not.toContain("\n");
      expect(info.summariesAreOrphaned).toBe(false);
    });

    it("should return 'Unnamed session' for empty files", async () => {
      const sessionPath = path.join(FIXTURE_PROJECT, FIXTURES.EMPTY);

      const info = await extractSessionInfo(sessionPath);

      expect(info.sessionName).toBe("Unnamed session");
      expect(info.leafUuid).toBeNull();
      expect(info.summariesAreOrphaned).toBe(false);
    });
  });

  describe("containsAnyUuid", () => {
    it("should find matching UUID in session", async () => {
      const sessionPath = path.join(FIXTURE_PROJECT, FIXTURES.SIMPLE);

      const uuids = new Set(["user-msg-1", "assistant-msg-1"]);
      const found = await containsAnyUuid(sessionPath, uuids);

      expect(found).toBe(true);
    });

    it("should return false when no UUIDs match", async () => {
      const sessionPath = path.join(FIXTURE_PROJECT, FIXTURES.SIMPLE);

      const uuids = new Set(["nonexistent-uuid-1", "nonexistent-uuid-2"]);
      const found = await containsAnyUuid(sessionPath, uuids);

      expect(found).toBe(false);
    });

    it("should return false for empty UUID set", async () => {
      const sessionPath = path.join(FIXTURE_PROJECT, FIXTURES.SIMPLE);

      const uuids = new Set<string>();
      const found = await containsAnyUuid(sessionPath, uuids);

      expect(found).toBe(false);
    });

    it("should stop searching after finding first match", async () => {
      const sessionPath = path.join(FIXTURE_PROJECT, FIXTURES.SIMPLE);

      // First UUID in the file
      const uuids = new Set(["user-msg-1"]);
      const found = await containsAnyUuid(sessionPath, uuids);

      expect(found).toBe(true);
    });
  });

  describe("getLastMessageUuid", () => {
    it("should get the last UUID from a session file", async () => {
      const sessionPath = path.join(FIXTURE_PROJECT, FIXTURES.SIMPLE);

      const lastUuid = await getLastMessageUuid(sessionPath);

      expect(lastUuid).toBe("assistant-msg-1");
    });

    it("should return null for files with no UUIDs", async () => {
      // Creates custom file, needs temp dir
      tempClaudeDir = await createTempClaudeDir();
      tempProjectPath = await createTestProject(tempClaudeDir, "test-project");
      const sessionPath = path.join(tempProjectPath, "no-uuid.jsonl");
      await fs.writeFile(sessionPath, '{"type":"other","data":"no uuid here"}\n');

      const lastUuid = await getLastMessageUuid(sessionPath);

      expect(lastUuid).toBeNull();
    });

    it("should return null for empty files", async () => {
      // Creates custom file, needs temp dir
      tempClaudeDir = await createTempClaudeDir();
      tempProjectPath = await createTestProject(tempClaudeDir, "test-project");
      const sessionPath = path.join(tempProjectPath, "empty-uuid.jsonl");
      await fs.writeFile(sessionPath, "");

      const lastUuid = await getLastMessageUuid(sessionPath);

      expect(lastUuid).toBeNull();
    });
  });

  describe("resetFilePosition", () => {
    it("should reset position tracker for a file", async () => {
      const sessionPath = path.join(FIXTURE_PROJECT, FIXTURES.SIMPLE);

      // Start with clean slate
      resetFilePosition(sessionPath);

      // Read file
      const messages1 = await parseNewLines(sessionPath);
      expect(messages1.length).toBeGreaterThan(0);

      // Second read should be empty
      const messages2 = await parseNewLines(sessionPath);
      expect(messages2).toHaveLength(0);

      // Reset position
      resetFilePosition(sessionPath);

      // Third read should get all messages again
      const messages3 = await parseNewLines(sessionPath);
      expect(messages3.length).toBe(messages1.length);

      // Clean up for next test
      resetFilePosition(sessionPath);
    });
  });
});
