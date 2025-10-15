import { Marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import chalk, { type ChalkInstance } from 'chalk';
import type { DisplayMessageBlock } from '../services/message-store.js';
import { CURSOR_WIDTH, MIN_CONTENT_WIDTH, CONTENT_LEFT_PADDING } from './constants.js';
import { getMarkedTerminalConfig } from './markdown-config.js';

/**
 * Options for rendering blocks to strings
 */
export interface BlockRenderOptions {
  terminalWidth: number;
  sessionColor?: ChalkInstance;
  showSessionInfo?: boolean;
  showProjectName?: boolean;
}

/**
 * Format a timestamp to a human-readable time string
 */
function formatTimestamp(ts: string): string {
  const date = new Date(ts);
  return date.toLocaleTimeString();
}

/**
 * Create a marked parser configured for terminal rendering
 */
function createParser(contentWidth: number): Marked {
  const parser = new Marked();
  parser.use(
    // @ts-expect-error - @types/marked-terminal@6.1.1 types are for marked v11, we're using v15
    markedTerminal(getMarkedTerminalConfig(contentWidth)),
  );
  return parser;
}

/**
 * Render a message block to a formatted string
 * This replicates the rendering logic from ThinkingBlock and UserMessageBlock
 */
export function renderBlockToString(
  block: DisplayMessageBlock,
  options: BlockRenderOptions,
): string {
  const { terminalWidth, sessionColor, showSessionInfo = true, showProjectName = true } = options;

  // Calculate content width (account for cursor padding on both sides + content indent)
  const contentWidth = Math.max(
    MIN_CONTENT_WIDTH,
    terminalWidth - 2 * CURSOR_WIDTH - CONTENT_LEFT_PADDING,
  );
  const parser = createParser(contentWidth);

  // Build the header line
  const parts: string[] = [];

  // Add timestamp
  parts.push(chalk.dim(formatTimestamp(block.timestamp)));

  // Add session/project info if needed
  if (showSessionInfo && (showProjectName ? block.projectName : block.sessionName)) {
    const displayColor = sessionColor || chalk.white;
    let sessionInfo = displayColor('[');

    if (showProjectName && block.projectName) {
      sessionInfo += displayColor(block.projectName);
      if (block.sessionName) {
        sessionInfo += displayColor(' / ');
      }
    }

    if (block.sessionName) {
      sessionInfo += displayColor(block.sessionName);
    }

    sessionInfo += displayColor(']');
    parts.push(sessionInfo);
  }

  // Add message type label
  if (block.type === 'thinking') {
    parts.push(chalk.bold(chalk.hex('#D97857')('Claude:')));
  } else {
    parts.push(chalk.bold(chalk.blue('User:')));
  }

  const headerLine = parts.join(' ');

  // Parse markdown content
  const content = block.type === 'thinking' ? block.thinking : block.content;
  const renderedMarkdown = (parser.parse(content) as string).trim();

  // Create padding strings
  const leftPadding = ' '.repeat(CURSOR_WIDTH);

  // Add cursor-width padding to header
  const paddedHeader = `${leftPadding}${headerLine}`;

  // Add cursor-width padding + content indent to content
  const contentIndent = ' '.repeat(CONTENT_LEFT_PADDING);
  const paddedContent = renderedMarkdown
    .split('\n')
    .map((line) => `${leftPadding}${contentIndent}${line}`)
    .join('\n');

  // Combine header and content with a blank line between them and after content
  return `${paddedHeader}\n\n${paddedContent}\n`;
}
