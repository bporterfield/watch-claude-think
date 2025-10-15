import type { MessageBlock } from './parser.js';

/**
 * Generate a unique key for a message block
 *
 * Thinking blocks include the thinking index to distinguish multiple
 * thinking blocks within the same message.
 *
 * @param block - The message block to generate a key for
 * @returns A unique string key for the block
 */
export function getBlockKey(block: MessageBlock): string {
  return block.type === 'thinking'
    ? `${block.sessionId}-${block.messageId}-${block.thinkingIndex}`
    : `${block.sessionId}-${block.messageId}`;
}

/**
 * Check if a text string is a system message that should be filtered out
 *
 * System messages include:
 * - Command-related messages (<command-name>, <command-message>, etc.)
 * - System reminders
 * - Caveats
 * - Empty strings
 *
 * @param text - The trimmed text content to check
 * @returns true if the text is a system message
 */
export function isSystemMessage(text: string): boolean {
  return (
    text.startsWith('<command-name>') ||
    text.startsWith('<command-message>') ||
    text.startsWith('<command-args>') ||
    text.startsWith('<local-command-stdout>') ||
    text.startsWith('Caveat:') ||
    text.startsWith('<system-reminder>') ||
    text.length === 0
  );
}
