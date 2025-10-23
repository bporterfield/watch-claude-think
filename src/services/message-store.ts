import type { ThinkingBlock, UserMessage } from '../lib/parser.js';
import { logger } from '../lib/logger.js';
import { getBlockKey } from '../lib/message-utils.js';

/**
 * Message block with optional display metadata
 */
export type DisplayMessageBlock = (ThinkingBlock | UserMessage) & {
  projectName?: string;
  sessionName?: string;
  sessionPath?: string;
};

/**
 * Event emitted when message blocks change
 */
export interface MessageBlocksChangeEvent {
  blocks: DisplayMessageBlock[];
}

/**
 * Callback type for message blocks change events
 */
export type MessageBlocksChangeCallback = (event: MessageBlocksChangeEvent) => void;

/**
 * Service for managing message blocks with deduplication
 *
 * Keeps all messages in memory (no eviction). The MAX_BLOCKS_INITAL_RENDER
 * limit is enforced at load time by SessionManager, not here.
 *
 * Responsibilities:
 * - Store message blocks with metadata
 * - Deduplicate blocks using unique keys
 * - Sort blocks chronologically
 * - Notify subscribers of changes
 */
export class MessageStore {
  private blocks: DisplayMessageBlock[] = [];
  private blockKeys = new Set<string>();
  private listeners: Set<MessageBlocksChangeCallback> = new Set();

  constructor() {
    // No configuration needed - we keep all messages
  }

  /**
   * Get the current message blocks
   */
  getBlocks(): DisplayMessageBlock[] {
    return this.blocks;
  }

  /**
   * Add new message blocks
   * Returns true if blocks were added, false if all were duplicates
   */
  addBlocks(newBlocks: DisplayMessageBlock[]): boolean {
    if (newBlocks.length === 0) {
      return false;
    }

    const blocksToAdd: DisplayMessageBlock[] = [];

    // Deduplicate
    for (const block of newBlocks) {
      const key = getBlockKey(block);
      if (!this.blockKeys.has(key)) {
        this.blockKeys.add(key);
        blocksToAdd.push(block);
      }
    }

    if (blocksToAdd.length === 0) {
      return false; // All duplicates
    }

    // Optimization: If all new blocks are newer than the last block, just append
    // Otherwise, merge and re-sort
    const lastBlock = this.blocks[this.blocks.length - 1];
    const lastTimestamp = lastBlock ? new Date(lastBlock.timestamp).getTime() : 0;

    const allBlocksNewer = blocksToAdd.every(
      (b) => new Date(b.timestamp).getTime() >= lastTimestamp,
    );

    if (allBlocksNewer) {
      // Fast path: just append
      this.blocks = [...this.blocks, ...blocksToAdd];
    } else {
      // Slow path: merge and re-sort (for clock drift/out-of-order)
      const merged = [...this.blocks, ...blocksToAdd];
      merged.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      this.blocks = merged;
    }

    // Notify listeners
    this.notifyChange();

    return true;
  }

  /**
   * Clear all blocks
   */
  clear(): void {
    try {
      this.blocks = [];
    } catch (error) {
      logger.error('Error clearing blocks array', error);
    }

    try {
      this.blockKeys.clear();
    } catch (error) {
      logger.error('Error clearing block keys', error);
    }

    try {
      this.notifyChange();
    } catch (error) {
      logger.error('Error notifying listeners of clear', error);
    }
  }

  /**
   * Subscribe to block changes
   * Returns unsubscribe function
   */
  subscribe(callback: MessageBlocksChangeCallback): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Notify all listeners of changes
   */
  private notifyChange(): void {
    const event: MessageBlocksChangeEvent = {
      blocks: this.blocks,
    };

    for (const listener of this.listeners) {
      listener(event);
    }
  }

  /**
   * Get current block count
   */
  getBlockCount(): number {
    return this.blocks.length;
  }
}
