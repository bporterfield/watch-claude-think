import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { getAllConversationsInFile } from '../../src/lib/parser.js';
import { listConversations } from '../../src/lib/file-system.js';

describe('Conversation Discovery', () => {
  let testDir: string;

  beforeEach(async () => {
    // Create temp directory for test files
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'conversation-test-'));
  });

  afterEach(async () => {
    // Clean up
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('getAllConversationsInFile', () => {
    it('should find single conversation in simple file', async () => {
      const sessionId = 'test-session-1';
      const leafUuid = 'leaf-uuid-1';
      const testFile = path.join(testDir, `${sessionId}.jsonl`);

      // Create test file with single conversation
      const lines = [
        JSON.stringify({
          type: 'summary',
          summary: 'Test Summary',
          leafUuid,
        }),
        JSON.stringify({
          type: 'user',
          uuid: 'msg-1',
          parentUuid: null,
          message: { content: 'Hello' },
          timestamp: '2024-01-01T00:00:00Z',
          sessionId,
          cwd: '/test',
          version: '1.0',
          gitBranch: 'main',
          userType: 'user',
          isSidechain: false,
        }),
        JSON.stringify({
          type: 'assistant',
          uuid: leafUuid,
          parentUuid: 'msg-1',
          message: { content: [{ type: 'text', text: 'Hi there' }] },
          timestamp: '2024-01-01T00:01:00Z',
          sessionId,
          cwd: '/test',
          version: '1.0',
          gitBranch: 'main',
          userType: 'user',
          isSidechain: false,
        }),
      ];

      await fs.writeFile(testFile, lines.join('\n'));

      const branches = await getAllConversationsInFile(testFile);

      expect(branches).toHaveLength(1);
      expect(branches[0]).toMatchObject({
        leafUuid,
        summary: 'Test Summary',
        messageCount: 2,
      });
    });

    it('should find multiple branches in branched conversation', async () => {
      const sessionId = 'test-session-2';
      const leaf1 = 'leaf-uuid-1';
      const leaf2 = 'leaf-uuid-2';
      const testFile = path.join(testDir, `${sessionId}.jsonl`);

      // Create test file with branched conversation
      const lines = [
        JSON.stringify({
          type: 'summary',
          summary: 'Branch 1 Summary',
          leafUuid: leaf1,
        }),
        JSON.stringify({
          type: 'summary',
          summary: 'Branch 2 Summary',
          leafUuid: leaf2,
        }),
        // Root message
        JSON.stringify({
          type: 'user',
          uuid: 'msg-1',
          parentUuid: null,
          message: { content: 'Start' },
          timestamp: '2024-01-01T00:00:00Z',
          sessionId,
          cwd: '/test',
          version: '1.0',
          gitBranch: 'main',
          userType: 'user',
          isSidechain: false,
        }),
        // Branch 1
        JSON.stringify({
          type: 'assistant',
          uuid: leaf1,
          parentUuid: 'msg-1',
          message: { content: [{ type: 'text', text: 'Branch 1' }] },
          timestamp: '2024-01-01T00:01:00Z',
          sessionId,
          cwd: '/test',
          version: '1.0',
          gitBranch: 'main',
          userType: 'user',
          isSidechain: false,
        }),
        // Branch 2
        JSON.stringify({
          type: 'assistant',
          uuid: leaf2,
          parentUuid: 'msg-1',
          message: { content: [{ type: 'text', text: 'Branch 2' }] },
          timestamp: '2024-01-01T00:02:00Z',
          sessionId,
          cwd: '/test',
          version: '1.0',
          gitBranch: 'main',
          userType: 'user',
          isSidechain: false,
        }),
      ];

      await fs.writeFile(testFile, lines.join('\n'));

      const branches = await getAllConversationsInFile(testFile);

      expect(branches).toHaveLength(2);
      expect(branches.map((b) => b.leafUuid)).toContain(leaf1);
      expect(branches.map((b) => b.leafUuid)).toContain(leaf2);
      expect(branches.find((b) => b.leafUuid === leaf1)?.summary).toBe('Branch 1 Summary');
      expect(branches.find((b) => b.leafUuid === leaf2)?.summary).toBe('Branch 2 Summary');
    });

    it('should use fallback name when no summary exists', async () => {
      const sessionId = 'test-session-3';
      const leafUuid = 'leaf-uuid-1';
      const testFile = path.join(testDir, `${sessionId}.jsonl`);

      const lines = [
        JSON.stringify({
          type: 'user',
          uuid: 'msg-1',
          parentUuid: null,
          message: { content: 'This is my first message' },
          timestamp: '2024-01-01T00:00:00Z',
          sessionId,
          cwd: '/test',
          version: '1.0',
          gitBranch: 'main',
          userType: 'user',
          isSidechain: false,
        }),
        JSON.stringify({
          type: 'assistant',
          uuid: leafUuid,
          parentUuid: 'msg-1',
          message: { content: [{ type: 'text', text: 'Response' }] },
          timestamp: '2024-01-01T00:01:00Z',
          sessionId,
          cwd: '/test',
          version: '1.0',
          gitBranch: 'main',
          userType: 'user',
          isSidechain: false,
        }),
      ];

      await fs.writeFile(testFile, lines.join('\n'));

      const branches = await getAllConversationsInFile(testFile);

      expect(branches).toHaveLength(1);
      expect(branches[0]?.summary).toBeNull();
      expect(branches[0]?.fallbackName).toBe('This is my first message');
    });

    it('should correctly count messages in chain', async () => {
      const sessionId = 'test-session-4';
      const leafUuid = 'leaf-uuid-1';
      const testFile = path.join(testDir, `${sessionId}.jsonl`);

      const lines = [
        JSON.stringify({
          type: 'user',
          uuid: 'msg-1',
          parentUuid: null,
          message: { content: 'First' },
          timestamp: '2024-01-01T00:00:00Z',
          sessionId,
          cwd: '/test',
          version: '1.0',
          gitBranch: 'main',
          userType: 'user',
          isSidechain: false,
        }),
        JSON.stringify({
          type: 'assistant',
          uuid: 'msg-2',
          parentUuid: 'msg-1',
          message: { content: [{ type: 'text', text: 'Second' }] },
          timestamp: '2024-01-01T00:01:00Z',
          sessionId,
          cwd: '/test',
          version: '1.0',
          gitBranch: 'main',
          userType: 'user',
          isSidechain: false,
        }),
        JSON.stringify({
          type: 'user',
          uuid: leafUuid,
          parentUuid: 'msg-2',
          message: { content: 'Third' },
          timestamp: '2024-01-01T00:02:00Z',
          sessionId,
          cwd: '/test',
          version: '1.0',
          gitBranch: 'main',
          userType: 'user',
          isSidechain: false,
        }),
      ];

      await fs.writeFile(testFile, lines.join('\n'));

      const branches = await getAllConversationsInFile(testFile);

      expect(branches).toHaveLength(1);
      expect(branches[0]?.messageCount).toBe(3);
    });
  });

  describe('listConversations', () => {
    it('should list conversations from multiple files', async () => {
      // Create two session files
      const session1 = 'session-1';
      const session2 = 'session-2';

      const file1 = path.join(testDir, `${session1}.jsonl`);
      const file2 = path.join(testDir, `${session2}.jsonl`);

      const lines1 = [
        JSON.stringify({
          type: 'user',
          uuid: 'leaf-1',
          parentUuid: null,
          message: { content: 'File 1' },
          timestamp: '2024-01-01T00:00:00Z',
          sessionId: session1,
          cwd: '/test',
          version: '1.0',
          gitBranch: 'main',
          userType: 'user',
          isSidechain: false,
        }),
      ];

      const lines2 = [
        JSON.stringify({
          type: 'user',
          uuid: 'leaf-2',
          parentUuid: null,
          message: { content: 'File 2' },
          timestamp: '2024-01-01T00:01:00Z',
          sessionId: session2,
          cwd: '/test',
          version: '1.0',
          gitBranch: 'main',
          userType: 'user',
          isSidechain: false,
        }),
      ];

      await fs.writeFile(file1, lines1.join('\n'));
      await fs.writeFile(file2, lines2.join('\n'));

      const conversations = await listConversations(testDir);

      expect(conversations).toHaveLength(2);
      // Should be sorted by most recent first
      expect(conversations[0]?.sessionId).toBe(session2);
      expect(conversations[1]?.sessionId).toBe(session1);
    });

    it('should flatten multiple branches into conversation list', async () => {
      const sessionId = 'branched-session';
      const testFile = path.join(testDir, `${sessionId}.jsonl`);

      const lines = [
        JSON.stringify({
          type: 'user',
          uuid: 'root',
          parentUuid: null,
          message: { content: 'Root' },
          timestamp: '2024-01-01T00:00:00Z',
          sessionId,
          cwd: '/test',
          version: '1.0',
          gitBranch: 'main',
          userType: 'user',
          isSidechain: false,
        }),
        JSON.stringify({
          type: 'assistant',
          uuid: 'leaf-1',
          parentUuid: 'root',
          message: { content: [{ type: 'text', text: 'Branch 1' }] },
          timestamp: '2024-01-01T00:01:00Z',
          sessionId,
          cwd: '/test',
          version: '1.0',
          gitBranch: 'main',
          userType: 'user',
          isSidechain: false,
        }),
        JSON.stringify({
          type: 'assistant',
          uuid: 'leaf-2',
          parentUuid: 'root',
          message: { content: [{ type: 'text', text: 'Branch 2' }] },
          timestamp: '2024-01-01T00:02:00Z',
          sessionId,
          cwd: '/test',
          version: '1.0',
          gitBranch: 'main',
          userType: 'user',
          isSidechain: false,
        }),
      ];

      await fs.writeFile(testFile, lines.join('\n'));

      const conversations = await listConversations(testDir);

      expect(conversations).toHaveLength(2);
      expect(conversations.every((c) => c.sessionId === sessionId)).toBe(true);
      expect(conversations.every((c) => c.sessionPath === testFile)).toBe(true);
    });
  });
});
