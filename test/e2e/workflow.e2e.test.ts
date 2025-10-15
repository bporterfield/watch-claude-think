import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import { listProjects } from '../../src/lib/file-system.js';
import { SessionWatcher } from '../../src/lib/session-watcher.js';
import { parseNewLines, parseEntireFile } from '../../src/lib/parser.js';
import { getProjectColor, assignProjectColors } from '../../src/lib/colors.js';
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
} from '../helpers/index.js';

/**
 * E2E tests that verify the complete workflow that the CLI would use
 * These tests simulate what happens when a user runs the CLI tool
 */
describe('end-to-end workflow', () => {
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

  it("should handle the complete 'watch single session' workflow", async () => {
    // Step 1: User starts CLI, app lists projects
    const project = await createTestProject(claudeDir, 'my-project');
    const projects = await listProjects(claudeDir);

    expect(projects).toHaveLength(1);
    expect(projects[0]?.name).toBe('my-project');

    // Step 2: User selects project, creates a session
    const sessionPath = path.join(project, 'my-session.jsonl');
    await copyFixture(FIXTURES.SIMPLE, sessionPath);

    // Step 3: User selects session, app starts watching and parsing
    const watcher = new SessionWatcher(project, [sessionPath], {
      onChange: () => {
        // File changed
      },
    });

    await watcher.waitForReady();

    // Initial parse
    const initialMessages = await parseNewLines(sessionPath);
    expect(initialMessages.length).toBeGreaterThan(0);

    // Step 4: Session updates, app detects and parses new messages
    const newMsg =
      '{"type":"user","message":{"role":"user","content":"New message"},"uuid":"new-1","timestamp":"2025-01-15T10:00:10.000Z","sessionId":"test","parentUuid":"assistant-msg-1","isSidechain":false,"userType":"default","cwd":"/test","version":"1.0.0","gitBranch":"main"}';
    await appendToFile(sessionPath, newMsg);

    await new Promise((resolve) => setTimeout(resolve, 200));

    const newMessages = await parseNewLines(sessionPath);
    expect(newMessages).toHaveLength(1);
    expect(newMessages[0]?.type).toBe('user');

    await watcher.close();
  });

  it("should handle the complete 'watch all sessions' workflow", async () => {
    // Step 1: User starts CLI and selects a project to watch all sessions
    const projectPath = await createTestProject(claudeDir, 'multi-session-project');

    const session1 = path.join(projectPath, 'session-1.jsonl');
    const session2 = path.join(projectPath, 'session-2.jsonl');

    await copyFixture(FIXTURES.SIMPLE, session1);
    await copyFixture(FIXTURES.MULTI_THINKING, session2);

    // Step 2: App assigns colors for visual distinction
    const projects = await listProjects(claudeDir);
    const colorMap = assignProjectColors(projects);

    expect(colorMap.size).toBe(1);
    expect(colorMap.get('project')).toBeDefined(); // Uses cwd basename from fixture

    // Step 3: App watches all session files in the project
    const sessionPaths = [session1, session2];
    const changedFiles = new Set<string>();

    const watcher = new SessionWatcher(projectPath, sessionPaths, {
      onChange: (filePath) => {
        changedFiles.add(filePath);
      },
    });

    // Wait for watcher to be ready
    await watcher.waitForReady();

    // Step 5: Multiple sessions update
    const newMsg =
      '{"type":"user","message":{"role":"user","content":"Update"},"uuid":"update-1","timestamp":"2025-01-15T10:00:10.000Z","sessionId":"test","parentUuid":null,"isSidechain":false,"userType":"default","cwd":"/test","version":"1.0.0","gitBranch":"main"}';

    // Parse initial messages
    await parseNewLines(session1);
    await parseNewLines(session2);

    await appendToFile(session1, newMsg);
    await appendToFile(session2, newMsg);

    // Step 6: App detects and parses updates from both
    await waitFor(() => changedFiles.size >= 1, TIMEOUTS.fileChange, 'multiple file changes');

    expect(changedFiles.size).toBeGreaterThan(0);

    await watcher.close();
  });

  it('should handle project selection with color coding', async () => {
    // Create multiple projects
    await createTestProject(claudeDir, 'alpha');
    await createTestProject(claudeDir, 'beta');
    await createTestProject(claudeDir, 'gamma');

    // List projects (what ProjectSelector component does)
    const projects = await listProjects(claudeDir);
    expect(projects).toHaveLength(3);

    // Assign colors (what ProjectSelector does)
    const colorMap = assignProjectColors(projects);

    // Each project gets a color
    projects.forEach((project) => {
      const color = colorMap.get(project.name);
      expect(color).toBeDefined();
      expect(typeof color).toBe('function');
    });

    // Also test hash-based color assignment (for "watch all" mode)
    const colorAlpha = getProjectColor('alpha');
    const colorBeta = getProjectColor('beta');

    expect(colorAlpha).toBeDefined();
    expect(colorBeta).toBeDefined();

    // Same project name always gets same color
    expect(getProjectColor('alpha')).toBe(colorAlpha);
  });

  it('should handle real-time message parsing and display', async () => {
    const projectPath = await createTestProject(claudeDir, 'streaming-test');
    const sessionPath = path.join(projectPath, 'stream.jsonl');

    await copyFixture(FIXTURES.SIMPLE, sessionPath);

    // Parse messages (what StreamView does)
    const messages = await parseEntireFile(sessionPath);

    // Should have both user messages and thinking blocks
    const userMessages = messages.filter((m) => m.type === 'user');
    const thinkingBlocks = messages.filter((m) => m.type === 'thinking');

    expect(userMessages.length).toBeGreaterThan(0);
    expect(thinkingBlocks.length).toBeGreaterThan(0);

    // Each message should have required fields for display
    messages.forEach((msg) => {
      expect(msg).toHaveProperty('type');
      expect(msg).toHaveProperty('timestamp');
      expect(msg).toHaveProperty('sessionId');
      expect(msg).toHaveProperty('messageId');

      if (msg.type === 'user') {
        expect(msg).toHaveProperty('content');
      } else if (msg.type === 'thinking') {
        expect(msg).toHaveProperty('thinking');
      }
    });
  });

  it('should handle new session creation (auto-resume)', async () => {
    const projectPath = await createTestProject(claudeDir, 'auto-resume-test');
    const originalPath = path.join(projectPath, 'original.jsonl');

    await copyFixture(FIXTURES.SIMPLE, originalPath);

    // User is watching all sessions in a project
    let newSessionDetected = false;
    let detectedNewPath = '';

    const watcher = new SessionWatcher(projectPath, [originalPath], {
      onChange: () => {
        // Change detected
      },
      onNewSession: (newPath) => {
        newSessionDetected = true;
        detectedNewPath = newPath;
      },
    });

    // Wait for watcher to be ready
    await watcher.waitForReady();

    // User opens a new Claude instance which auto-resumes from the original session
    // This creates a new file with a summary linking back to original
    const resumedPath = path.join(projectPath, 'resumed.jsonl');
    await copyFixture(FIXTURES.COMPACTED, resumedPath);

    // Wait for new session detection (with automatic retry in CI environments)
    await waitForWithRetry(
      () => newSessionDetected,
      TIMEOUTS.newSession,
      undefined,
      'new session detection'
    );

    // Wait for queue to finish processing
    await watcher.waitForIdle();

    // Verify the workflow completed successfully
    expect(newSessionDetected).toBe(true);
    expect(detectedNewPath).toBe(resumedPath);

    await watcher.close();
  });

  it('should handle errors gracefully', async () => {
    // Try to list projects when directory doesn't exist
    const projects = await listProjects('/nonexistent/path');
    expect(projects).toEqual([]);
  });
});
