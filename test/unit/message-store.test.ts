import { describe, it, expect, beforeEach, vi } from "vitest";
import { MessageStore, type DisplayMessageBlock } from "../../src/services/message-store.js";

describe("MessageStore", () => {
  let store: MessageStore;

  const createUserMessage = (id: string, timestamp: string): DisplayMessageBlock => ({
    type: "user",
    content: `Message ${id}`,
    sessionId: "session-1",
    messageId: id,
    timestamp,
    parentUuid: null,
  });

  const createThinkingBlock = (id: string, timestamp: string, index = 0): DisplayMessageBlock => ({
    type: "thinking",
    thinking: `Thinking ${id}`,
    sessionId: "session-1",
    messageId: id,
    timestamp,
    thinkingIndex: index,
  });

  beforeEach(() => {
    store = new MessageStore();
  });

  describe("constructor", () => {
    it("should create a store", () => {
      store = new MessageStore();

      expect(store).toBeDefined();
      expect(store.getBlockCount()).toBe(0);
    });
  });

  describe("addBlocks", () => {
    it("should add new blocks", () => {
      const block = createUserMessage("msg-1", "2025-01-15T10:00:00.000Z");

      const added = store.addBlocks([block]);

      expect(added).toBe(true);
      expect(store.getBlockCount()).toBe(1);
      expect(store.getBlocks()).toEqual([block]);
    });

    it("should add multiple blocks", () => {
      const block1 = createUserMessage("msg-1", "2025-01-15T10:00:00.000Z");
      const block2 = createUserMessage("msg-2", "2025-01-15T10:00:01.000Z");

      const added = store.addBlocks([block1, block2]);

      expect(added).toBe(true);
      expect(store.getBlockCount()).toBe(2);
    });

    it("should return false when adding empty array", () => {
      const added = store.addBlocks([]);

      expect(added).toBe(false);
      expect(store.getBlockCount()).toBe(0);
    });

    it("should deduplicate blocks with same key", () => {
      const block = createUserMessage("msg-1", "2025-01-15T10:00:00.000Z");

      store.addBlocks([block]);
      const added = store.addBlocks([block]); // Same block again

      expect(added).toBe(false);
      expect(store.getBlockCount()).toBe(1);
    });

    it("should allow same messageId if different thinking index", () => {
      const block1 = createThinkingBlock("msg-1", "2025-01-15T10:00:00.000Z", 0);
      const block2 = createThinkingBlock("msg-1", "2025-01-15T10:00:01.000Z", 1);

      store.addBlocks([block1]);
      const added = store.addBlocks([block2]);

      expect(added).toBe(true);
      expect(store.getBlockCount()).toBe(2);
    });

    it("should append blocks when all new blocks are newer", () => {
      const block1 = createUserMessage("msg-1", "2025-01-15T10:00:00.000Z");
      const block2 = createUserMessage("msg-2", "2025-01-15T10:00:01.000Z");

      store.addBlocks([block1]);
      store.addBlocks([block2]);

      const blocks = store.getBlocks();
      expect(blocks[0]?.messageId).toBe("msg-1");
      expect(blocks[1]?.messageId).toBe("msg-2");
    });

    it("should re-sort blocks when out-of-order timestamps", () => {
      const block1 = createUserMessage("msg-1", "2025-01-15T10:00:02.000Z");
      const block2 = createUserMessage("msg-2", "2025-01-15T10:00:00.000Z"); // Older

      store.addBlocks([block1]);
      store.addBlocks([block2]); // Out of order

      const blocks = store.getBlocks();
      expect(blocks[0]?.messageId).toBe("msg-2"); // Should be first (older)
      expect(blocks[1]?.messageId).toBe("msg-1");
    });

    it("should notify listeners when blocks are added", () => {
      const callback = vi.fn();
      store.subscribe(callback);

      const block = createUserMessage("msg-1", "2025-01-15T10:00:00.000Z");

      store.addBlocks([block]);

      expect(callback).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledWith({
        blocks: [block],
      });
    });

    it("should not notify listeners when no blocks added", () => {
      const callback = vi.fn();
      store.subscribe(callback);

      store.addBlocks([]);

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe("getBlocks", () => {
    it("should return empty array for new store", () => {
      const blocks = store.getBlocks();

      expect(blocks).toEqual([]);
    });

    it("should return all blocks", () => {
      const block1 = createUserMessage("msg-1", "2025-01-15T10:00:00.000Z");
      const block2 = createUserMessage("msg-2", "2025-01-15T10:00:01.000Z");

      store.addBlocks([block1, block2]);

      const blocks = store.getBlocks();

      expect(blocks).toHaveLength(2);
      expect(blocks).toEqual([block1, block2]);
    });
  });

  describe("getBlockCount", () => {
    it("should return 0 for new store", () => {
      expect(store.getBlockCount()).toBe(0);
    });

    it("should return correct count after adding blocks", () => {
      const blocks = [
        createUserMessage("msg-1", "2025-01-15T10:00:00.000Z"),
        createUserMessage("msg-2", "2025-01-15T10:00:01.000Z"),
        createUserMessage("msg-3", "2025-01-15T10:00:02.000Z"),
      ];

      store.addBlocks(blocks);

      expect(store.getBlockCount()).toBe(3);
    });
  });

  describe("clear", () => {
    it("should remove all blocks", () => {
      const blocks = [
        createUserMessage("msg-1", "2025-01-15T10:00:00.000Z"),
        createUserMessage("msg-2", "2025-01-15T10:00:01.000Z"),
      ];

      store.addBlocks(blocks);
      expect(store.getBlockCount()).toBe(2);

      store.clear();

      expect(store.getBlockCount()).toBe(0);
      expect(store.getBlocks()).toEqual([]);
    });

    it("should clear deduplication set", () => {
      const block = createUserMessage("msg-1", "2025-01-15T10:00:00.000Z");

      store.addBlocks([block]);
      store.clear();

      // Should be able to add same block again
      const added = store.addBlocks([block]);
      expect(added).toBe(true);
    });

    it("should notify listeners when cleared", () => {
      const callback = vi.fn();
      store.subscribe(callback);

      const block = createUserMessage("msg-1", "2025-01-15T10:00:00.000Z");
      store.addBlocks([block]);

      callback.mockClear();

      store.clear();

      expect(callback).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledWith({
        blocks: [],
      });
    });

    it("should handle errors during clear gracefully", () => {
      // This tests the error handling in the clear method
      // Even if an error occurs, clear should complete
      expect(() => store.clear()).not.toThrow();
    });
  });

  describe("subscribe", () => {
    it("should allow subscribing to changes", () => {
      const callback = vi.fn();

      store.subscribe(callback);

      const block = createUserMessage("msg-1", "2025-01-15T10:00:00.000Z");
      store.addBlocks([block]);

      expect(callback).toHaveBeenCalled();
    });

    it("should return unsubscribe function", () => {
      const callback = vi.fn();

      const unsubscribe = store.subscribe(callback);

      const block = createUserMessage("msg-1", "2025-01-15T10:00:00.000Z");
      store.addBlocks([block]);

      expect(callback).toHaveBeenCalledOnce();

      callback.mockClear();
      unsubscribe();

      store.addBlocks([createUserMessage("msg-2", "2025-01-15T10:00:01.000Z")]);

      expect(callback).not.toHaveBeenCalled();
    });

    it("should support multiple listeners", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      store.subscribe(callback1);
      store.subscribe(callback2);

      const block = createUserMessage("msg-1", "2025-01-15T10:00:00.000Z");
      store.addBlocks([block]);

      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
    });

    it("should provide current blocks in notification", () => {
      const callback = vi.fn();
      store.subscribe(callback);

      const block1 = createUserMessage("msg-1", "2025-01-15T10:00:00.000Z");
      const block2 = createUserMessage("msg-2", "2025-01-15T10:00:01.000Z");

      store.addBlocks([block1]);
      store.addBlocks([block2]);

      // Second call should have both blocks
      expect(callback).toHaveBeenLastCalledWith({
        blocks: [block1, block2],
      });
    });
  });

  describe("edge cases", () => {
    it("should handle blocks with same timestamp", () => {
      const block1 = createUserMessage("msg-1", "2025-01-15T10:00:00.000Z");
      const block2 = createUserMessage("msg-2", "2025-01-15T10:00:00.000Z"); // Same timestamp

      store.addBlocks([block1, block2]);

      expect(store.getBlockCount()).toBe(2);
    });

    it("should handle blocks with metadata", () => {
      const block: DisplayMessageBlock = {
        type: "user",
        content: "Test",
        sessionId: "session-1",
        messageId: "msg-1",
        timestamp: "2025-01-15T10:00:00.000Z",
        parentUuid: null,
        projectName: "my-project",
        sessionName: "My Session",
      };

      store.addBlocks([block]);

      const stored = store.getBlocks()[0];
      expect(stored?.projectName).toBe("my-project");
      expect(stored?.sessionName).toBe("My Session");
    });

    it("should handle mix of user messages and thinking blocks", () => {
      const userMsg = createUserMessage("msg-1", "2025-01-15T10:00:00.000Z");
      const thinking = createThinkingBlock("msg-2", "2025-01-15T10:00:01.000Z");

      store.addBlocks([userMsg, thinking]);

      expect(store.getBlockCount()).toBe(2);

      const blocks = store.getBlocks();
      expect(blocks[0]?.type).toBe("user");
      expect(blocks[1]?.type).toBe("thinking");
    });
  });
});
