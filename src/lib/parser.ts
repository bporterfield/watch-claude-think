import fs from 'fs';
import readline from 'readline';
import {
  type JSONLEntry,
  type ClaudeMessageEntry,
  type ThinkingContent,
  type SummaryEntry,
} from '../types/claude-message.js';
import { logger } from './logger.js';
import { isSystemMessage } from './message-utils.js';
import {
  POSITION_CACHE_SIZE,
  FILE_TAIL_BYTES,
  LAST_MESSAGE_BYTES,
  SESSION_NAME_MAX_LENGTH,
} from './constants.js';

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
  timestamp: string;
  sessionId: string;
  messageId: string; // UUID of the message containing this thinking block
  thinkingIndex: number; // Index of this thinking block within the message
}

export interface UserMessage {
  type: 'user';
  content: string;
  timestamp: string;
  sessionId: string;
  messageId: string;
  parentUuid: string | null;
}

export type MessageBlock = ThinkingBlock | UserMessage;

/**
 * Simple LRU cache implementation for file positions
 * Limits memory usage by evicting least recently used entries when max size is reached
 */
class LRUCache<K, V> {
  private cache: Map<K, V>;
  private maxSize: number;

  constructor(maxSize: number) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    // Remove if exists to update position
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Add to end (most recently used)
    this.cache.set(key, value);

    // Evict oldest entry if over limit
    if (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value as K;
      this.cache.delete(firstKey);
    }
  }

  delete(key: K): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }
}

/**
 * Track the last read position for each file
 * Limited to prevent unbounded memory growth in long-running sessions
 */
const filePositions = new LRUCache<string, number>(POSITION_CACHE_SIZE);

/**
 * Helper class to collect summary entries from the top of a JSONL file
 * Encapsulates the logic for reading all consecutive summary entries
 * until hitting a non-summary entry (summaries are always at the top)
 */
class SummaryCollector {
  private summaries: Array<{ summary: string; leafUuid: string }> = [];
  private done = false;

  /**
   * Process a JSONL entry, collecting summaries until a non-summary is encountered
   * @param entry The parsed JSONL entry
   */
  processLine(entry: JSONLEntry): void {
    if (this.done) return;

    if (entry.type === 'summary') {
      const summaryEntry = entry as SummaryEntry;
      this.summaries.push({
        summary: summaryEntry.summary,
        leafUuid: summaryEntry.leafUuid,
      });
    } else {
      // Hit a non-summary line, we're done collecting summaries
      this.done = true;
    }
  }

  /**
   * Check if we've finished collecting summaries (hit a non-summary line)
   */
  isDone(): boolean {
    return this.done;
  }

  /**
   * Get all collected summaries
   */
  getSummaries(): Array<{ summary: string; leafUuid: string }> {
    return this.summaries;
  }
}

/**
 * Check if a message entry contains thinking content
 */
function hasThinkingContent(entry: JSONLEntry): entry is ClaudeMessageEntry {
  // Skip non-message entries (summary, file-history-snapshot, system)
  // System messages (local_command, compact_boundary, api_error) are not displayed in the UI
  if (entry.type !== 'assistant' && entry.type !== 'user') {
    return false;
  }

  const message = (entry as ClaudeMessageEntry).message;

  if (!message || typeof message !== 'object') {
    return false;
  }

  if ('content' in message && Array.isArray(message.content)) {
    return message.content.some((item) => typeof item === 'object' && item.type === 'thinking');
  }

  return false;
}

/**
 * Check if entry is a user message
 */
function isUserMessage(entry: JSONLEntry): entry is ClaudeMessageEntry {
  return entry.type === 'user';
}

/**
 * Extract user message content
 *
 * Filters out system-generated messages using structural markers:
 * 1. isMeta flag (Caveat messages)
 * 2. toolUseResult field (tool output messages with <system-reminder> tags)
 * 3. Content-based filtering (fallback for <command-*> messages without markers)
 */
function extractUserMessage(entry: ClaudeMessageEntry): UserMessage | null {
  // Filter out system messages marked with isMeta: true (e.g., Caveat messages)
  if (entry.isMeta) {
    return null;
  }

  // Filter out tool result messages (often contain <system-reminder> tags)
  if (entry.toolUseResult) {
    return null;
  }

  // Filter out sidechain messages
  if (entry.isSidechain) {
    return null;
  }

  const message = entry.message;

  if (!('content' in message)) {
    return null;
  }

  let content = '';

  if (typeof message.content === 'string') {
    content = message.content;
  } else if (Array.isArray(message.content)) {
    const textContent = message.content.find(
      (item) => typeof item === 'object' && item.type === 'text',
    );
    if (textContent && 'text' in textContent) {
      content = textContent.text as string;
    }
  }

  if (!content) {
    return null;
  }

  const trimmedContent = content.trim();

  // Filter system messages by content (fallback for <command-*> messages without structural markers)
  if (isSystemMessage(trimmedContent)) {
    return null;
  }

  return {
    type: 'user',
    content: trimmedContent,
    timestamp: entry.timestamp,
    sessionId: entry.sessionId,
    messageId: entry.uuid,
    parentUuid: entry.parentUuid,
  };
}

/**
 * Find the root user message in a conversation chain by walking backwards from leaf to root
 * Returns formatted text suitable for display (truncated to 40 chars)
 *
 * @param leaf The leaf message (end of conversation branch)
 * @param messageMap Map of message UUIDs to messages for efficient parent lookup
 * @returns Formatted root user message text, or null if no valid user message found
 */
function findRootUserMessage(
  leaf: ClaudeMessageEntry,
  messageMap: Map<string, ClaudeMessageEntry>,
): string | null {
  let current: ClaudeMessageEntry | undefined = leaf;
  let rootUserMessageText: string | null = null;

  // Walk backwards from leaf to root, keeping the last user message found (which is the root)
  while (current) {
    if (current.type === 'user') {
      // Skip sidechain messages
      if (!current.isSidechain) {
        const message = current.message;
        if ('content' in message) {
          let text = '';

          if (typeof message.content === 'string') {
            text = message.content;
          } else if (Array.isArray(message.content)) {
            const textContent = message.content.find(
              (item) => typeof item === 'object' && item.type === 'text',
            );
            if (textContent && 'text' in textContent) {
              text = textContent.text as string;
            }
          }

          if (text) {
            text = text.trim();
            if (!isSystemMessage(text)) {
              // Format for display
              let formattedText = text.replace(/\r?\n/g, ' ');
              if (formattedText.length > SESSION_NAME_MAX_LENGTH) {
                formattedText = formattedText.substring(0, SESSION_NAME_MAX_LENGTH) + '...';
              }
              rootUserMessageText = formattedText;
            }
          }
        }
      }
    }

    // Move to parent
    current = current.parentUuid ? messageMap.get(current.parentUuid) : undefined;
  }

  return rootUserMessageText;
}

/**
 * Extract thinking blocks from a message entry
 */
function extractThinkingBlocks(entry: ClaudeMessageEntry): ThinkingBlock[] {
  // Filter out thinking blocks from sidechain messages
  if (entry.isSidechain) {
    return [];
  }

  const message = entry.message;

  if (!('content' in message) || !Array.isArray(message.content)) {
    return [];
  }

  const thinkingContents = message.content.filter(
    (item): item is ThinkingContent => typeof item === 'object' && item.type === 'thinking',
  );

  return thinkingContents.map((content, index) => ({
    type: 'thinking',
    thinking: content.thinking.trim(),
    timestamp: entry.timestamp,
    sessionId: entry.sessionId,
    messageId: entry.uuid,
    thinkingIndex: index,
  }));
}

/**
 * Parse new lines from a JSONL file since last read
 */
export async function parseNewLines(filePath: string): Promise<MessageBlock[]> {
  const lastPosition = filePositions.get(filePath) || 0;
  const messageBlocks: MessageBlock[] = [];

  logger.debug('[parseNewLines] Reading file', { filePath, lastPosition });

  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, {
      start: lastPosition,
      encoding: 'utf-8',
    });

    const rl = readline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    let currentPosition = lastPosition;

    rl.on('line', (line) => {
      currentPosition += Buffer.byteLength(line, 'utf-8') + 1; // +1 for newline

      if (!line.trim()) {
        return;
      }

      try {
        const entry = JSON.parse(line) as JSONLEntry;

        if (isUserMessage(entry)) {
          const userMsg = extractUserMessage(entry);
          if (userMsg) {
            messageBlocks.push(userMsg);
          }
        } else if (hasThinkingContent(entry)) {
          const blocks = extractThinkingBlocks(entry);
          messageBlocks.push(...blocks);
        }
      } catch (error) {
        // Skip invalid JSON lines (expected during file writes)
        logger.debug('Skipped invalid JSON line in parseNewLines', { filePath, error });
      }
    });

    rl.on('close', () => {
      filePositions.set(filePath, currentPosition);
      resolve(messageBlocks);
    });

    rl.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Reset the file position tracker for a file
 */
export function resetFilePosition(filePath: string): void {
  filePositions.delete(filePath);
}

/**
 * Parse entire file from the beginning
 */
export async function parseEntireFile(filePath: string): Promise<MessageBlock[]> {
  resetFilePosition(filePath);
  return parseNewLines(filePath);
}

/**
 * Parse only the tail (last N bytes) of a file
 * This is much more memory-efficient for large files
 * @param filePath Path to the JSONL file
 * @param maxBytes Maximum bytes to read from the end (default from app-config)
 */
export async function parseFileTail(
  filePath: string,
  maxBytes: number = FILE_TAIL_BYTES,
): Promise<MessageBlock[]> {
  // Get file size
  const stats = await fs.promises.stat(filePath);
  const fileSize = stats.size;

  // If file is smaller than maxBytes, just read the whole thing
  if (fileSize <= maxBytes) {
    resetFilePosition(filePath);
    return parseNewLines(filePath);
  }

  // Calculate where to start reading
  const startPosition = fileSize - maxBytes;

  return new Promise((resolve, reject) => {
    const messageBlocks: MessageBlock[] = [];
    const stream = fs.createReadStream(filePath, {
      start: startPosition,
      encoding: 'utf-8',
    });

    const rl = readline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    let firstLine = true;
    let currentPosition = startPosition;

    rl.on('line', (line) => {
      // Track position for all lines (including skipped first line)
      currentPosition += Buffer.byteLength(line, 'utf-8') + 1; // +1 for newline

      // Skip the first line as it might be incomplete (started mid-line)
      if (firstLine) {
        firstLine = false;
        return;
      }

      if (!line.trim()) {
        return;
      }

      try {
        const entry = JSON.parse(line) as JSONLEntry;

        if (isUserMessage(entry)) {
          const userMsg = extractUserMessage(entry);
          if (userMsg) {
            messageBlocks.push(userMsg);
          }
        } else if (hasThinkingContent(entry)) {
          const blocks = extractThinkingBlocks(entry);
          messageBlocks.push(...blocks);
        }
      } catch (error) {
        // Skip invalid JSON lines (expected during file writes)
        logger.debug('Skipped invalid JSON line in parseFileTail', { filePath, error });
      }
    });

    rl.on('close', () => {
      // Update file position cache so parseNewLines knows where we left off
      filePositions.set(filePath, currentPosition);
      resolve(messageBlocks);
    });

    rl.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Extract session information in a single file read
 * Implements Claude Code's session naming rules including orphaned summary detection
 */
export async function extractSessionInfo(filePath: string): Promise<{
  leafUuid: string | null;
  sessionName: string;
  cwd: string | null;
  summariesAreOrphaned: boolean;
  summaryIdInUse: string | null;
}> {
  logger.debug('[extractSessionInfo] Reading session info', { filePath });
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, {
      encoding: 'utf-8',
    });

    const rl = readline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    const collector = new SummaryCollector();
    let cwd: string | null = null;
    let firstUserMessageParentUuid: string | null | undefined = undefined;
    let firstUserMessageText: string | null = null;

    rl.on('line', (line) => {
      if (!line.trim()) {
        return;
      }

      try {
        const entry = JSON.parse(line) as JSONLEntry;

        // Collect all summaries at the top of the file
        collector.processLine(entry);

        // Extract cwd if present
        if (!cwd && 'cwd' in entry && typeof entry.cwd === 'string') {
          cwd = entry.cwd;
        }

        // Look for first user message (needed for both orphan detection and fallback naming)
        if (firstUserMessageParentUuid === undefined && entry.type === 'user') {
          const messageEntry = entry as ClaudeMessageEntry;

          // Skip system messages (marked with isMeta: true or containing toolUseResult)
          if (messageEntry.isMeta || messageEntry.toolUseResult) {
            return;
          }

          // Skip sidechain messages
          if (messageEntry.isSidechain) {
            return;
          }

          const message = messageEntry.message;

          if ('content' in message) {
            let text = '';

            // Handle both string and array content, always looking for "text" type
            if (typeof message.content === 'string') {
              text = message.content;
            } else if (Array.isArray(message.content)) {
              const textContent = message.content.find(
                (item) => typeof item === 'object' && item.type === 'text',
              );
              if (textContent && 'text' in textContent) {
                text = textContent.text as string;
              }
            }

            if (text) {
              text = text.trim();

              // Skip system messages by content (for messages without isMeta flag)
              if (!isSystemMessage(text)) {
                // Store the parent UUID for orphan detection
                firstUserMessageParentUuid = messageEntry.parentUuid;
                firstUserMessageText = text;

                // If we have all the info we need, we can close
                const summaries = collector.getSummaries();
                const hasSummary = summaries.length > 0;
                if (cwd !== null && (!hasSummary || firstUserMessageParentUuid !== undefined)) {
                  rl.close();
                }
              }
            }
          }
        }
      } catch (error) {
        // Skip invalid lines (expected during file writes)
        logger.debug('Skipped invalid JSON line in extractSessionInfo', { filePath, error });
      }
    });

    rl.on('close', () => {
      // Get collected summaries
      const summaries = collector.getSummaries();
      const hasSummary = summaries.length > 0;
      const leafUuid = summaries[0]?.leafUuid ?? null;
      const summaryText = summaries[0]?.summary ?? null;

      // Determine if we have a user message yet
      const hasUserMessage = firstUserMessageParentUuid !== undefined;

      // Summary is valid ONLY if user message's parentUuid matches a summary's leafUuid
      // Otherwise the summary is orphaned (resume cancelled, unrelated conversation, etc)
      const parentPointsToSummary = summaries.some(
        (s) => s.leafUuid === firstUserMessageParentUuid,
      );
      const summariesAreOrphaned = hasSummary && hasUserMessage && !parentPointsToSummary;

      logger.debug('[extractSessionInfo] Computing session name', {
        filePath,
        hasSummary,
        summaryCount: summaries.length,
        summaryText,
        hasUserMessage,
        firstUserMessageParentUuid,
        firstUserMessageText: firstUserMessageText
          ? firstUserMessageText.substring(0, 50) + '...'
          : null,
        summariesAreOrphaned,
      });

      // Track which summary we're using (if any)
      let summaryIdInUse: string | null = null;
      let sessionName: string | null = null;

      // Apply naming rules:
      // Rule 1: Only use summary if we have a user message AND it's not orphaned
      // Rule 2: If orphaned or no summary, use first user message
      // Rule 3: If no user message yet, return "Unnamed session" (don't trust summaries without messages)
      if (hasUserMessage && summaryText && !summariesAreOrphaned) {
        // Valid summary with linking message - use it
        sessionName = summaryText;
        summaryIdInUse = leafUuid; // Track that we're using this summary
      } else if (firstUserMessageText) {
        // Orphaned summary or no summary - use formatted first user message
        let text = firstUserMessageText.replace(/\r?\n/g, ' ');
        if (text.length > SESSION_NAME_MAX_LENGTH) {
          text = text.substring(0, SESSION_NAME_MAX_LENGTH) + '...';
        }
        sessionName = text;
        summaryIdInUse = null; // Not using any summary
      }
      // Otherwise falls through to "Unnamed session" below (summaryIdInUse stays null)

      const result = {
        leafUuid,
        sessionName: sessionName || 'Unnamed session',
        cwd,
        summariesAreOrphaned,
        summaryIdInUse,
      };

      logger.debug('[extractSessionInfo] Extracted session info', {
        filePath,
        sessionName: result.sessionName,
        leafUuid: result.leafUuid,
        cwd: result.cwd,
        summariesAreOrphaned: result.summariesAreOrphaned,
        summaryIdInUse: result.summaryIdInUse,
      });

      resolve(result);
    });

    rl.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Extract ALL summaries from a file (for files with multiple summaries)
 * Returns both summary text and leafUuid for orphaned summary reassignment
 * Files can contain multiple summary entries at the top when Claude resumes or compacts sessions
 */
export async function getAllSummaries(
  filePath: string,
): Promise<Array<{ summary: string; leafUuid: string }>> {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, {
      encoding: 'utf-8',
    });

    const rl = readline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    const collector = new SummaryCollector();

    rl.on('line', (line) => {
      // Once we've collected all summaries, stop reading
      if (collector.isDone()) {
        rl.close();
        return;
      }

      if (!line.trim()) {
        return;
      }

      try {
        const entry = JSON.parse(line) as JSONLEntry;
        collector.processLine(entry);

        // Close if we've finished collecting summaries
        if (collector.isDone()) {
          rl.close();
        }
      } catch (error) {
        // Skip invalid lines and continue (expected during file writes)
        logger.debug('Skipped invalid JSON line in getAllSummaries', { filePath, error });
      }
    });

    rl.on('close', () => {
      resolve(collector.getSummaries());
    });

    rl.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Extract ALL leafUuids from a file (for files with multiple summaries)
 * Files can contain multiple summary entries at the top when Claude resumes or compacts sessions
 */
export async function getAllLeafUuids(filePath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, {
      encoding: 'utf-8',
    });

    const rl = readline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    const leafUuids: string[] = [];
    let seenNonSummary = false;

    rl.on('line', (line) => {
      // Once we've seen a non-summary line, all summaries are done (they're at the top)
      if (seenNonSummary) {
        rl.close();
        return;
      }

      if (!line.trim()) {
        return;
      }

      try {
        const entry = JSON.parse(line) as JSONLEntry;

        if (entry.type === 'summary') {
          const summaryEntry = entry as SummaryEntry;
          leafUuids.push(summaryEntry.leafUuid);
        } else {
          // Hit a non-summary line, stop reading
          seenNonSummary = true;
          rl.close();
        }
      } catch (error) {
        // Skip invalid lines and continue (expected during file writes)
        logger.debug('Skipped invalid JSON line in getAllLeafUuids', { filePath, error });
      }
    });

    rl.on('close', () => {
      resolve(leafUuids);
    });

    rl.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Check if a session file contains any message with a UUID from the given set
 */
export async function containsAnyUuid(filePath: string, uuids: Set<string>): Promise<boolean> {
  if (uuids.size === 0) {
    return false;
  }

  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, {
      encoding: 'utf-8',
    });

    const rl = readline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    let found = false;

    rl.on('line', (line) => {
      if (found) {
        rl.close();
        return;
      }

      if (!line.trim()) {
        return;
      }

      try {
        const entry = JSON.parse(line) as JSONLEntry;

        // Check if this entry has a UUID that matches any in our set
        if ('uuid' in entry && uuids.has(entry.uuid)) {
          found = true;
          resolve(true);
          rl.close();
        }
      } catch (error) {
        // Skip invalid lines (expected during file writes)
        logger.debug('Skipped invalid JSON line in containsAnyUuid', { filePath, error });
      }
    });

    rl.on('close', () => {
      if (!found) {
        resolve(false);
      }
    });

    rl.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Extract the last message UUID from a file
 * This is used to detect compaction - when a new file's leafUuid matches this
 *
 * OPTIMIZED: Reads only the last portion instead of entire file for 50x performance gain
 */
export async function getLastMessageUuid(filePath: string): Promise<string | null> {
  // Get file size
  const stats = await fs.promises.stat(filePath);
  const fileSize = stats.size;

  // Read last portion (enough for ~20-50 JSONL entries)
  const bytesToRead = Math.min(LAST_MESSAGE_BYTES, fileSize);
  const buffer = Buffer.alloc(bytesToRead);

  const fileHandle = await fs.promises.open(filePath, 'r');
  const { bytesRead } = await fileHandle.read(buffer, 0, bytesToRead, fileSize - bytesToRead);
  await fileHandle.close();

  // Convert to string and split into lines
  const content = buffer.toString('utf-8', 0, bytesRead);
  const lines = content.split('\n').reverse(); // Start from end

  // Find the first valid entry with a UUID (working backwards)
  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const entry = JSON.parse(line) as JSONLEntry;
      if ('uuid' in entry) {
        return entry.uuid;
      }
    } catch (error) {
      // Skip partial/invalid lines at buffer boundary (expected)
      logger.debug('Skipped invalid JSON line in getLastMessageUuid', { filePath, error });
    }
  }

  return null;
}

/**
 * Information about a conversation branch in a session file
 */
export interface ConversationBranch {
  leafUuid: string;
  summary: string | null;
  fallbackName: string | null;
  timestamp: string;
  messageCount: number;
}

/**
 * Extract both summaries and conversations from a session file in a single pass
 * More efficient than calling getAllSummaries() and getAllConversationsInFile() separately
 *
 * @param filePath Path to the session file
 * @returns Object containing summaries and conversation branches
 */
export async function extractSummariesAndConversations(filePath: string): Promise<{
  summaries: Array<{ summary: string; leafUuid: string }>;
  conversations: ConversationBranch[];
}> {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, {
      encoding: 'utf-8',
    });

    const rl = readline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    // Collect all message entries and summaries
    const messages: ClaudeMessageEntry[] = [];
    const summaryCollector = new SummaryCollector();

    rl.on('line', (line) => {
      if (!line.trim()) {
        return;
      }

      try {
        const entry = JSON.parse(line) as JSONLEntry;

        // Collect summaries
        summaryCollector.processLine(entry);

        // Collect message entries (user and assistant)
        if (entry.type === 'user' || entry.type === 'assistant') {
          messages.push(entry as ClaudeMessageEntry);
        }
      } catch (error) {
        // Skip invalid JSON lines (expected during file writes)
        logger.debug('Skipped invalid JSON line in extractSummariesAndConversations', {
          filePath,
          error,
        });
      }
    });

    rl.on('close', () => {
      const summaries = summaryCollector.getSummaries();

      // Build local summary map for this file
      const localSummaryMap = new Map(summaries.map((s) => [s.leafUuid, s.summary]));

      // Find leaf messages (messages with no children)
      const parentUuids = new Set(
        messages.map((m) => m.parentUuid).filter((p): p is string => p !== null),
      );
      const leafMessages = messages.filter((m) => !parentUuids.has(m.uuid));

      logger.debug('[extractSummariesAndConversations] Extracted data', {
        filePath,
        summaryCount: summaries.length,
        messageCount: messages.length,
        leafCount: leafMessages.length,
      });

      // Build message map for efficient lookup
      const messageMap = new Map(messages.map((m) => [m.uuid, m]));

      // For each leaf, build the conversation branch (with local summaries only for now)
      const conversations: ConversationBranch[] = leafMessages.map((leaf) => {
        // Walk the chain backwards to root to count messages
        const chain: ClaudeMessageEntry[] = [];
        let current: ClaudeMessageEntry | undefined = leaf;

        while (current) {
          chain.unshift(current);
          current = current.parentUuid ? messageMap.get(current.parentUuid) : undefined;
        }

        return {
          leafUuid: leaf.uuid,
          summary: localSummaryMap.get(leaf.uuid) ?? null, // Local summary only
          fallbackName: findRootUserMessage(leaf, messageMap),
          timestamp: leaf.timestamp,
          messageCount: chain.length,
        };
      });

      resolve({ summaries, conversations });
    });

    rl.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Extract all conversation branches from a session file
 * A conversation branch is a chain of messages from root to a leaf (endpoint with no children)
 *
 * Based on the logic from research/sessions/GET_SUMMARY_EXAMPLE.js
 *
 * @param filePath Path to the session file
 * @param globalSummaryMap Optional map of leafUuid -> summary from ALL session files (for cross-file summary lookup)
 */
export async function getAllConversationsInFile(
  filePath: string,
  globalSummaryMap?: Map<string, string>,
): Promise<ConversationBranch[]> {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, {
      encoding: 'utf-8',
    });

    const rl = readline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    });

    // Collect all message entries and summaries
    const messages: ClaudeMessageEntry[] = [];
    const summaryCollector = new SummaryCollector();

    rl.on('line', (line) => {
      if (!line.trim()) {
        return;
      }

      try {
        const entry = JSON.parse(line) as JSONLEntry;

        // Collect summaries
        summaryCollector.processLine(entry);

        // Collect message entries (user and assistant)
        if (entry.type === 'user' || entry.type === 'assistant') {
          messages.push(entry as ClaudeMessageEntry);
        }
      } catch (error) {
        // Skip invalid JSON lines (expected during file writes)
        logger.debug('Skipped invalid JSON line in getAllConversationsInFile', { filePath, error });
      }
    });

    rl.on('close', () => {
      // Build summary map: leafUuid -> summary text
      // If globalSummaryMap is provided, use it (cross-file lookup)
      // Otherwise fall back to local summaries from this file only
      const localSummaries = summaryCollector.getSummaries();
      const summaryMap =
        globalSummaryMap || new Map(localSummaries.map((s) => [s.leafUuid, s.summary]));

      // Find leaf messages (messages with no children)
      // A message is a leaf if no other message has it as parentUuid
      const parentUuids = new Set(
        messages.map((m) => m.parentUuid).filter((p): p is string => p !== null),
      );
      const leafMessages = messages.filter((m) => !parentUuids.has(m.uuid));

      logger.debug('[getAllConversationsInFile] Found conversations', {
        filePath,
        totalMessages: messages.length,
        leafCount: leafMessages.length,
        summaryCount: summaryMap.size,
      });

      // Build message map for efficient lookup
      const messageMap = new Map(messages.map((m) => [m.uuid, m]));

      // For each leaf, build the conversation branch
      const branches: ConversationBranch[] = leafMessages.map((leaf) => {
        // Walk the chain backwards to root to count messages
        const chain: ClaudeMessageEntry[] = [];
        let current: ClaudeMessageEntry | undefined = leaf;

        while (current) {
          chain.unshift(current);
          current = current.parentUuid ? messageMap.get(current.parentUuid) : undefined;
        }

        return {
          leafUuid: leaf.uuid,
          summary: summaryMap.get(leaf.uuid) ?? null,
          fallbackName: findRootUserMessage(leaf, messageMap),
          timestamp: leaf.timestamp,
          messageCount: chain.length,
        };
      });

      resolve(branches);
    });

    rl.on('error', (error) => {
      reject(error);
    });
  });
}
