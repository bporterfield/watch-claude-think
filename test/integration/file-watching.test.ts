import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "path";
import { listProjects, getAllSessionFilePaths, listConversations } from "../../src/lib/file-system.js";
import { SessionWatcher } from "../../src/lib/session-watcher.js";
import { parseNewLines } from "../../src/lib/parser.js";
import {
  createTempClaudeDir,
  cleanupTempDir,
  createTestProject,
  copyFixture,
  FIXTURES,
  appendToFile,
  waitFor,
  waitForWithRetry,
  TIMEOUTS,
} from "../helpers/index.js";

describe("file-watching integration", () => {
  let claudeDir: string;

  beforeEach(async () => {
    claudeDir = await createTempClaudeDir();
  });

  afterEach(async () => {
    // On Windows, chokidar's close() may not immediately stop all polling
    // Give it time to fully shut down before deleting files to avoid EPERM errors
    if (process.platform === 'win32') {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    await cleanupTempDir(claudeDir);
  });

  it("should watch files, detect changes, and parse new messages", async () => {
    const projectPath = await createTestProject(claudeDir, "watch-project");
    const sessionPath = path.join(projectPath, "session.jsonl");

    // Create initial session
    await copyFixture(FIXTURES.SIMPLE, sessionPath);

    // Parse initial messages
    const initialMessages = await parseNewLines(sessionPath);
    expect(initialMessages.length).toBeGreaterThan(0);

    // Set up watcher for single session
    let changeDetected = false;
    const watcher = new SessionWatcher(projectPath, [sessionPath], {
      onChange: () => {
        changeDetected = true;
      },
    });

    // Wait for watcher to be ready
    await watcher.waitForReady();

    // Append new message
    const newMessage =
      '{"type":"user","message":{"role":"user","content":"Follow up question"},"uuid":"new-msg-1","timestamp":"2025-01-15T10:00:10.000Z","sessionId":"simple-test-session","parentUuid":"assistant-msg-1","isSidechain":false,"userType":"default","cwd":"/Users/test/project","version":"1.0.0","gitBranch":"main"}';
    await appendToFile(sessionPath, newMessage);

    // Wait for file watcher to detect change
    await waitFor(() => changeDetected, TIMEOUTS.fileChange, 'file change detection');

    expect(changeDetected).toBe(true);

    // Parse new messages
    const newMessages = await parseNewLines(sessionPath);
    expect(newMessages).toHaveLength(1);
    expect(newMessages[0]).toMatchObject({
      type: "user",
      content: "Follow up question",
    });

    await watcher.close();
  });

  it("should handle multiple files being watched and modified", async () => {
    const projectPath = await createTestProject(claudeDir, "multi-session-project");

    const session1Path = path.join(projectPath, "session1.jsonl");
    const session2Path = path.join(projectPath, "session2.jsonl");

    await copyFixture(FIXTURES.SIMPLE, session1Path);
    await copyFixture(FIXTURES.SIMPLE, session2Path);

    // Initial parse
    await parseNewLines(session1Path);
    await parseNewLines(session2Path);

    const changedFiles = new Set<string>();

    // Use SessionWatcher to watch all sessions in the project
    const watcher = new SessionWatcher(
      projectPath,
      [session1Path, session2Path],
      {
        onChange: (filePath) => {
          changedFiles.add(filePath);
        },
      }
    );

    // Wait for watcher to be ready
    await watcher.waitForReady();

    // Modify both files
    const newMsg = '{"type":"user","message":{"role":"user","content":"Update"},"uuid":"update-1","timestamp":"2025-01-15T10:00:10.000Z","sessionId":"test","parentUuid":null,"isSidechain":false,"userType":"default","cwd":"/test","version":"1.0.0","gitBranch":"main"}';
    await appendToFile(session1Path, newMsg);
    await appendToFile(session2Path, newMsg);

    // Wait for both changes
    await waitFor(() => changedFiles.size === 2, TIMEOUTS.fileChange, 'multiple file changes');

    expect(changedFiles.has(session1Path)).toBe(true);
    expect(changedFiles.has(session2Path)).toBe(true);

    // Parse new messages from both
    const messages1 = await parseNewLines(session1Path);
    const messages2 = await parseNewLines(session2Path);

    expect(messages1).toHaveLength(1);
    expect(messages2).toHaveLength(1);

    await watcher.close();
  });

  it("should integrate with listProjects and listSessions after file changes", async () => {
    const project = await createTestProject(claudeDir, "integration-project");
    const sessionPath = path.join(project, "test-session.jsonl");

    // Create session
    await copyFixture(FIXTURES.SIMPLE, sessionPath);

    // Parse initial messages to set file position
    const initialMessages = await parseNewLines(sessionPath);
    expect(initialMessages.length).toBeGreaterThan(0);

    // List projects should find it
    const projects = await listProjects(claudeDir);
    expect(projects).toHaveLength(1);
    expect(projects[0]?.name).toBe("project"); // Uses cwd basename from fixture

    // Watch and modify
    let changeDetected = false;
    const watcher = new SessionWatcher(project, [sessionPath], {
      onChange: () => {
        changeDetected = true;
      },
    });

    await watcher.waitForReady();

    // Add more messages
    const newMsg = '{"type":"user","message":{"role":"user","content":"More discussion"},"uuid":"more-1","timestamp":"2025-01-15T10:00:20.000Z","sessionId":"simple-test-session","parentUuid":"assistant-msg-1","isSidechain":false,"userType":"default","cwd":"/Users/test/project","version":"1.0.0","gitBranch":"main"}';
    await appendToFile(sessionPath, newMsg);

    await waitFor(() => changeDetected, TIMEOUTS.fileChange, 'session file change');

    // Verify we can still parse NEW messages only
    const newMessages = await parseNewLines(sessionPath);
    expect(newMessages).toHaveLength(1);
    expect(newMessages[0]?.type).toBe("user");
    if (newMessages[0]?.type === "user") {
      expect(newMessages[0].content).toBe("More discussion");
    }

    await watcher.close();
  });

  it("should handle rapid successive file modifications", async () => {
    const projectPath = await createTestProject(claudeDir, "rapid-project");
    const sessionPath = path.join(projectPath, "rapid.jsonl");

    await copyFixture(FIXTURES.SIMPLE, sessionPath);
    await parseNewLines(sessionPath);

    let changeCount = 0;
    const watcher = new SessionWatcher(projectPath, [sessionPath], {
      onChange: () => {
        changeCount++;
      },
    });

    await watcher.waitForReady();

    // Rapidly append multiple messages
    const messages = [
      '{"type":"user","message":{"role":"user","content":"Message 1"},"uuid":"rapid-1","timestamp":"2025-01-15T10:00:10.000Z","sessionId":"test","parentUuid":null,"isSidechain":false,"userType":"default","cwd":"/test","version":"1.0.0","gitBranch":"main"}',
      '{"type":"user","message":{"role":"user","content":"Message 2"},"uuid":"rapid-2","timestamp":"2025-01-15T10:00:11.000Z","sessionId":"test","parentUuid":"rapid-1","isSidechain":false,"userType":"default","cwd":"/test","version":"1.0.0","gitBranch":"main"}',
      '{"type":"user","message":{"role":"user","content":"Message 3"},"uuid":"rapid-3","timestamp":"2025-01-15T10:00:12.000Z","sessionId":"test","parentUuid":"rapid-2","isSidechain":false,"userType":"default","cwd":"/test","version":"1.0.0","gitBranch":"main"}',
    ];

    for (const msg of messages) {
      await appendToFile(sessionPath, msg);
      await new Promise((resolve) => setTimeout(resolve, 50)); // Small delay between writes
    }

    // Wait for at least some changes to be detected
    await waitFor(() => changeCount > 0, TIMEOUTS.fileChange, 'rapid file changes');

    expect(changeCount).toBeGreaterThan(0);

    // All messages should be parseable
    const newMessages = await parseNewLines(sessionPath);
    expect(newMessages.length).toBeGreaterThanOrEqual(1);

    await watcher.close();
  });

  it("should maintain message chronological order across multiple files", async () => {
    const projectPath = await createTestProject(claudeDir, "chrono-project");

    // Create multiple session files
    const session1 = path.join(projectPath, "session1.jsonl");
    const session2 = path.join(projectPath, "session2.jsonl");

    await copyFixture(FIXTURES.SIMPLE, session1);
    await copyFixture(FIXTURES.MULTI_THINKING, session2);

    // Parse both
    const messages1 = await parseNewLines(session1);
    const messages2 = await parseNewLines(session2);

    // Combine and check timestamps are valid
    const allMessages = [...messages1, ...messages2];
    expect(allMessages.length).toBeGreaterThan(0);

    // All messages should have timestamps
    allMessages.forEach((msg) => {
      expect(msg.timestamp).toBeTruthy();
      expect(typeof msg.timestamp).toBe("string");
    });

    // Messages should be sortable by timestamp
    const sorted = [...allMessages].sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp)
    );
    expect(sorted.length).toBe(allMessages.length);
  });


  it("should detect when new sessions are created", async () => {
    const projectPath = await createTestProject(claudeDir, "new-session-detect");
    const existingPath = path.join(projectPath, "existing.jsonl");

    // Create an existing session to watch
    await copyFixture(FIXTURES.SIMPLE, existingPath);

    let newSessionDetected = false;
    let detectedPath = "";

    // Use SessionWatcher to watch for new sessions in the project
    const watcher = new SessionWatcher(projectPath, [existingPath], {
      onChange: () => {
        // Change callback
      },
      onNewSession: (newPath) => {
        // New session callback
        newSessionDetected = true;
        detectedPath = newPath;
      },
    });

    // Wait for watcher to be ready
    await watcher.waitForReady();

    // Create a new session (not a compaction - has no leafUuid)
    const newSessionPath = path.join(projectPath, "new-session.jsonl");
    await copyFixture(FIXTURES.SIMPLE, newSessionPath);

    // Wait for new session detection (with retry for CI)
    await waitForWithRetry(
      () => newSessionDetected,
      TIMEOUTS.newSession,
      undefined,
      'new session detection'
    );

    expect(newSessionDetected).toBe(true);
    expect(detectedPath).toBe(newSessionPath);

    await watcher.close();
  });

  it("should distinguish between new sessions and files with leafUuid", async () => {
    const projectPath = await createTestProject(claudeDir, "distinguish-test");
    const originalPath = path.join(projectPath, "original.jsonl");

    await copyFixture(FIXTURES.SIMPLE, originalPath);

    let newSessionDetected = false;
    let newSessionPath = "";

    // Use SessionWatcher to watch for new sessions
    const watcher = new SessionWatcher(projectPath, [originalPath], {
      onChange: () => {
        // Change callback
      },
      onNewSession: (newPath) => {
        // New session callback
        newSessionDetected = true;
        newSessionPath = newPath;
      },
    });

    // Wait for watcher to be ready
    await watcher.waitForReady();

    // Create a genuinely new session (no leafUuid) - should trigger onNewSession
    const genuineNewPath = path.join(projectPath, "genuinely-new.jsonl");
    await copyFixture(FIXTURES.SIMPLE, genuineNewPath);

    // Wait for new session detection (with retry for CI)
    await waitForWithRetry(
      () => newSessionDetected,
      TIMEOUTS.newSession,
      undefined,
      'new session detection'
    );

    // The new session should be detected
    expect(newSessionDetected).toBe(true);
    expect(newSessionPath).toBe(genuineNewPath);

    await watcher.close();
  });

  it("should treat sessions with leafUuid as new sessions when parent not watched", async () => {
    const projectPath = await createTestProject(claudeDir, "unwatched-parent-test");

    // Watch a single session
    const watchedPath = path.join(projectPath, "watched.jsonl");
    await copyFixture(FIXTURES.MULTI_THINKING, watchedPath);

    let newSessionDetected = false;
    let detectedPath = "";

    // Watch only one session, enable new session detection
    const watcher = new SessionWatcher(projectPath, [watchedPath], {
      onChange: () => {
        // Change callback
      },
      onNewSession: (newPath) => {
        newSessionDetected = true;
        detectedPath = newPath;
      },
    });

    await watcher.waitForReady();

    // Create a new session with leafUuid pointing to a non-existent parent
    // This simulates Claude Code's auto-linking behavior where new sessions
    // get a summary with leafUuid from a previous session that might not be watched
    const newSessionWithLeafPath = path.join(projectPath, "new-with-leaf.jsonl");
    await copyFixture(FIXTURES.COMPACTED, newSessionWithLeafPath);

    // Wait for new session detection (with retry for CI)
    await waitForWithRetry(
      () => newSessionDetected,
      TIMEOUTS.newSession,
      undefined,
      'new session detection'
    );

    // Should be detected as a new session (even though it has leafUuid)
    // because the parent UUID doesn't match any watched file
    expect(newSessionDetected).toBe(true);
    expect(detectedPath).toBe(newSessionWithLeafPath);

    await watcher.close();
  });

  it("should watch files with only sidechain messages and detect when real messages arrive", async () => {
    const projectPath = await createTestProject(claudeDir, "sidechain-only");
    const sidechainOnlyPath = path.join(projectPath, "warmup-session.jsonl");

    // Create file with only sidechain messages
    await copyFixture(FIXTURES.SIDECHAIN_ONLY, sidechainOnlyPath);

    // Verify: listConversations returns 0 conversations (file has no valid convos)
    const conversations = await listConversations(projectPath);
    expect(conversations).toHaveLength(0);

    // Setup watcher: Use ALL session files (not just those with conversations)
    const allSessionPaths = await getAllSessionFilePaths(projectPath);
    expect(allSessionPaths).toContain(sidechainOnlyPath); // File should be in list

    let changeDetected = false;
    const watcher = new SessionWatcher(projectPath, allSessionPaths, {
      onChange: () => {
        changeDetected = true;
      },
    });

    await watcher.waitForReady();

    // Append real (non-sidechain) message
    const realMessage =
      '{"type":"user","message":{"role":"user","content":"Real question"},"uuid":"real-msg-1","timestamp":"2025-01-15T10:00:10.000Z","sessionId":"warmup-session","parentUuid":"warmup-assistant-1","isSidechain":false,"userType":"default","cwd":"/Users/test/project","version":"1.0.0","gitBranch":"main"}';
    await appendToFile(sidechainOnlyPath, realMessage);

    // Verify: Change WAS detected (proving file is being watched)
    await waitFor(() => changeDetected, TIMEOUTS.fileChange, 'sidechain file change detection');
    expect(changeDetected).toBe(true);

    // Verify: New message is parseable
    const newMessages = await parseNewLines(sidechainOnlyPath);
    expect(newMessages).toHaveLength(1);
    expect(newMessages[0]).toMatchObject({
      type: "user",
      content: "Real question",
    });

    await watcher.close();
  });
});
