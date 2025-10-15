import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SessionManager, type SessionFile } from "../../src/services/session-manager.js";
import type { ThinkingBlock, UserMessage } from "../../src/lib/parser.js";

// Mock dependencies
vi.mock("../../src/lib/session-watcher.js");

vi.mock("../../src/lib/parser.js", () => ({
  parseNewLines: vi.fn(),
  parseFileTail: vi.fn(),
  extractSessionInfo: vi.fn(),
}));

vi.mock("../../src/lib/logger.js");

import { SessionWatcher } from "../../src/lib/session-watcher.js";
import { parseNewLines, parseFileTail, extractSessionInfo } from "../../src/lib/parser.js";

describe("SessionManager", () => {
  let manager: SessionManager;
  let mockWatcher: {
    addKnownFile: ReturnType<typeof vi.fn>;
    removeKnownFile: ReturnType<typeof vi.fn>;
    updateFilePath: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    waitForIdle: ReturnType<typeof vi.fn>;
  };

  const mockSessionFiles: SessionFile[] = [
    {
      projectName: "project-1",
      projectPath: "/path/to/project-1",
      sessionPath: "/path/to/session-1.jsonl",
      sessionName: "Session 1",
    },
    {
      projectName: "project-1",
      projectPath: "/path/to/project-1",
      sessionPath: "/path/to/session-2.jsonl",
      sessionName: "Session 2",
    },
  ];

  const mockUserMessage: UserMessage = {
    type: "user",
    content: "Test message",
    sessionId: "session-1",
    messageId: "msg-1",
    timestamp: "2025-01-15T10:00:00.000Z",
    parentUuid: null,
  };

  const mockThinkingBlock: ThinkingBlock = {
    type: "thinking",
    thinking: "Test thinking",
    sessionId: "session-1",
    messageId: "msg-2",
    timestamp: "2025-01-15T10:00:01.000Z",
    thinkingIndex: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock watcher shared interface
    mockWatcher = {
      addKnownFile: vi.fn(),
      removeKnownFile: vi.fn(),
      updateFilePath: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
    };

    // Mock SessionWatcher constructor to return our mock
    vi.mocked(SessionWatcher).mockReturnValue(mockWatcher as unknown as SessionWatcher);

    vi.mocked(parseFileTail).mockResolvedValue([]);
    vi.mocked(parseNewLines).mockResolvedValue([]);
    vi.mocked(extractSessionInfo).mockResolvedValue({
      sessionName: "Test Session",
      leafUuid: null,
      cwd: "/test/project",
      summariesAreOrphaned: false,
      summaryIdInUse: null,
    });
  });

  afterEach(async () => {
    if (manager) {
      await manager.cleanup();
    }
  });

  describe("constructor", () => {
    it("should create a session manager with session files", () => {
      manager = new SessionManager(mockSessionFiles, "project-1", "/path/to/project-1");

      expect(manager).toBeDefined();
    });

    it("should handle empty session files array", () => {
      manager = new SessionManager([], "test-project", "/path/to/test-project");

      expect(manager).toBeDefined();
    });
  });

  describe("initialize", () => {
    it("should parse initial content from all sessions", async () => {
      vi.mocked(parseFileTail).mockResolvedValueOnce([mockUserMessage]);
      vi.mocked(parseFileTail).mockResolvedValueOnce([mockThinkingBlock]);

      manager = new SessionManager(mockSessionFiles, "project-1", "/path/to/project-1");
      await manager.initialize();

      expect(parseFileTail).toHaveBeenCalledTimes(2);
      // Should be called with file path and calculated byte limit
      expect(parseFileTail).toHaveBeenCalledWith("/path/to/session-1.jsonl", expect.any(Number));
      expect(parseFileTail).toHaveBeenCalledWith("/path/to/session-2.jsonl", expect.any(Number));
    });

    it("should emit initial messages event with project and session metadata", async () => {
      vi.mocked(parseFileTail).mockResolvedValueOnce([mockUserMessage]);
      vi.mocked(parseFileTail).mockResolvedValueOnce([mockThinkingBlock]);

      const callback = vi.fn();

      manager = new SessionManager(mockSessionFiles, "project-1", "/path/to/project-1");
      manager.onNewMessages(callback);

      await manager.initialize();

      expect(callback).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledWith({
        messages: expect.arrayContaining([
          expect.objectContaining({
            ...mockUserMessage,
            projectName: "project-1",
            sessionName: "Session 1",
          }),
          expect.objectContaining({
            ...mockThinkingBlock,
            projectName: "project-1",
            sessionName: "Session 2",
          }),
        ]),
        source: "initial",
      });
    });

    it("should sort initial messages by timestamp", async () => {
      const olderMessage: UserMessage = {
        ...mockUserMessage,
        timestamp: "2025-01-15T09:00:00.000Z",
      };

      const newerMessage: ThinkingBlock = {
        ...mockThinkingBlock,
        timestamp: "2025-01-15T11:00:00.000Z",
      };

      // Return in wrong order
      vi.mocked(parseFileTail).mockResolvedValueOnce([newerMessage]);
      vi.mocked(parseFileTail).mockResolvedValueOnce([olderMessage]);

      const callback = vi.fn();

      manager = new SessionManager(mockSessionFiles, "project-1", "/path/to/project-1");
      manager.onNewMessages(callback);

      await manager.initialize();

      const messages = callback.mock.calls[0]?.[0]?.messages;

      // Should be sorted chronologically
      expect(messages?.[0]?.timestamp).toBe("2025-01-15T09:00:00.000Z");
      expect(messages?.[1]?.timestamp).toBe("2025-01-15T11:00:00.000Z");
    });

    it("should not emit event when no initial messages", async () => {
      vi.mocked(parseFileTail).mockResolvedValue([]);

      const callback = vi.fn();

      manager = new SessionManager(mockSessionFiles, "project-1", "/path/to/project-1");
      manager.onNewMessages(callback);

      await manager.initialize();

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("event subscription", () => {
    beforeEach(() => {
      manager = new SessionManager(mockSessionFiles, "project-1", "/path/to/project-1");
    });

    it("should allow subscribing to new messages", async () => {
      const callback = vi.fn();
      manager.onNewMessages(callback);

      vi.mocked(parseFileTail).mockResolvedValue([mockUserMessage]);

      await manager.initialize();

      expect(callback).toHaveBeenCalled();
    });

    it("should allow unsubscribing from new messages", async () => {
      const callback = vi.fn();
      const unsubscribe = manager.onNewMessages(callback);

      unsubscribe();

      vi.mocked(parseFileTail).mockResolvedValue([mockUserMessage]);

      await manager.initialize();

      expect(callback).not.toHaveBeenCalled();
    });

    it("should support multiple listeners", async () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      manager.onNewMessages(callback1);
      manager.onNewMessages(callback2);

      vi.mocked(parseFileTail).mockResolvedValue([mockUserMessage]);

      await manager.initialize();

      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    beforeEach(() => {
      manager = new SessionManager(mockSessionFiles, "project-1", "/path/to/project-1");
    });

    it("should emit error event when parseFileTail fails during initialization", async () => {
      const errorCallback = vi.fn();
      const parseError = new Error("Failed to parse file");

      vi.mocked(parseFileTail).mockRejectedValueOnce(parseError);
      vi.mocked(parseFileTail).mockResolvedValueOnce([mockUserMessage]);

      manager.onError(errorCallback);
      await manager.initialize();

      expect(errorCallback).toHaveBeenCalledWith({
        type: "parse-error",
        filePath: "/path/to/session-1.jsonl",
        error: parseError,
        recoverable: true,
      });
    });

    it("should allow subscribing to error events", () => {
      const errorCallback = vi.fn();
      const unsubscribe = manager.onError(errorCallback);

      expect(unsubscribe).toBeInstanceOf(Function);
    });

    it("should allow unsubscribing from error events", async () => {
      const errorCallback = vi.fn();
      const parseError = new Error("Failed to parse file");

      vi.mocked(parseFileTail).mockRejectedValue(parseError);

      const unsubscribe = manager.onError(errorCallback);
      unsubscribe();

      await manager.initialize();

      expect(errorCallback).not.toHaveBeenCalled();
    });

    it("should support multiple error listeners", async () => {
      const errorCallback1 = vi.fn();
      const errorCallback2 = vi.fn();
      const parseError = new Error("Failed to parse file");

      // Only fail one session to ensure we call error listeners once
      vi.mocked(parseFileTail).mockRejectedValueOnce(parseError);
      vi.mocked(parseFileTail).mockResolvedValueOnce([mockUserMessage]);

      manager.onError(errorCallback1);
      manager.onError(errorCallback2);

      await manager.initialize();

      expect(errorCallback1).toHaveBeenCalledOnce();
      expect(errorCallback2).toHaveBeenCalledOnce();
    });

    it("should continue initialization after parse error in one session", async () => {
      const messageCallback = vi.fn();
      const errorCallback = vi.fn();

      vi.mocked(parseFileTail).mockRejectedValueOnce(new Error("Parse failed"));
      vi.mocked(parseFileTail).mockResolvedValueOnce([mockUserMessage]);

      manager.onNewMessages(messageCallback);
      manager.onError(errorCallback);

      await manager.initialize();

      // Should emit error for first session
      expect(errorCallback).toHaveBeenCalledOnce();

      // Should still emit messages from successful session
      expect(messageCallback).toHaveBeenCalledWith({
        messages: expect.arrayContaining([
          expect.objectContaining({
            ...mockUserMessage,
            projectName: "project-1",
            sessionName: "Session 2",
          }),
        ]),
        source: "initial",
      });
    });
  });

  describe("cleanup", () => {
    beforeEach(async () => {
      manager = new SessionManager(mockSessionFiles, "project-1", "/path/to/project-1");
      await manager.initialize();
    });

    it("should close the watcher", async () => {
      await manager.cleanup();

      expect(mockWatcher.close).toHaveBeenCalled();
    });

    it("should clear event listeners", async () => {
      const callback = vi.fn();
      const errorCallback = vi.fn();
      manager.onNewMessages(callback);
      manager.onError(errorCallback);

      await manager.cleanup();

      // After cleanup, initialize should not trigger the old listeners
      vi.mocked(parseFileTail).mockResolvedValue([mockUserMessage]);

      manager = new SessionManager(mockSessionFiles, "project-1", "/path/to/project-1");
      await manager.initialize();

      expect(callback).not.toHaveBeenCalled();
      expect(errorCallback).not.toHaveBeenCalled();
    });

    it("should handle cleanup errors gracefully", async () => {
      mockWatcher.close.mockRejectedValue(new Error("Close error"));

      // Should not throw
      await expect(manager.cleanup()).resolves.not.toThrow();
    });

    it("should allow cleanup to be called multiple times", async () => {
      await manager.cleanup();

      // Should not throw on second call
      await expect(manager.cleanup()).resolves.not.toThrow();
    });
  });
});
