/**
 * Terminal Operations Module
 * Based on Claude Code's custom rendering pipeline
 *
 * Provides direct terminal manipulation via ANSI escape codes
 * for efficient rendering that bypasses React/Ink for static content
 */

/**
 * ANSI Escape Codes
 */
export const ANSI = {
  // Synchronized update support (prevents flicker)
  SYNC_START: '\x1B[?2026h',
  SYNC_END: '\x1B[?2026l',

  // Cursor control
  CURSOR_HIDE: '\x1B[?25l',
  CURSOR_SHOW: '\x1B[?25h',
  CURSOR_LEFT: '\x1B[G',
  CURSOR_UP: (count = 1) => `\x1B[${count}A`,

  // Erase operations
  ERASE_LINE: '\x1B[2K',

  // Clear terminal
  CLEAR_SCREEN_AND_SCROLLBACK: '\x1B[2J\x1B[3J\x1B[H',
  CLEAR_SCREEN_WINDOWS: '\x1B[2J\x1B[0f',
};

/**
 * Get platform-appropriate clear terminal sequence
 */
export function getClearSequence(): string {
  if (process.platform === 'win32') {
    const isWindowsTerminal = !!process.env.WT_SESSION;
    const isVSCode =
      process.env.TERM_PROGRAM === 'vscode' && !!process.env.TERM_PROGRAM_VERSION;

    if (isWindowsTerminal || isVSCode) {
      return ANSI.CLEAR_SCREEN_AND_SCROLLBACK;
    }
    return ANSI.CLEAR_SCREEN_WINDOWS;
  }
  return ANSI.CLEAR_SCREEN_AND_SCROLLBACK;
}

/**
 * Erase N lines by moving cursor up and clearing each line
 */
export function eraseLines(count: number): string {
  if (count <= 0) return '';

  let output = '';
  for (let i = 0; i < count; i++) {
    output += ANSI.ERASE_LINE;
    if (i < count - 1) {
      output += ANSI.CURSOR_UP();
    }
  }
  output += ANSI.CURSOR_LEFT;
  return output;
}

/**
 * Terminal operation types
 */
export type TerminalOperation =
  | { type: 'stdout'; content: string; scrollback?: boolean }
  | { type: 'stderr'; content: string }
  | { type: 'clear'; count: number }
  | { type: 'clearTerminal' }
  | { type: 'cursorHide' }
  | { type: 'cursorShow' }
  | { type: 'synchronizedUpdateStart' }
  | { type: 'synchronizedUpdateEnd' };

/**
 * Terminal interface for operations
 */
export interface Terminal {
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
}

/**
 * Execute terminal operations by writing directly to stdout/stderr
 *
 * This bypasses React/Ink rendering for maximum performance
 *
 * @param terminal - Terminal streams (stdout/stderr)
 * @param operations - Array of operations to execute
 */
export function executeTerminalOperations(
  terminal: Terminal,
  operations: TerminalOperation[],
): void {
  let buffer = '';

  for (const op of operations) {
    switch (op.type) {
      case 'stdout':
        buffer += op.content;
        break;

      case 'stderr':
        // Flush stdout buffer before writing to stderr
        if (buffer) {
          terminal.stdout.write(buffer);
          buffer = '';
        }
        terminal.stderr.write(op.content);
        break;

      case 'clear':
        // Clear N lines by moving cursor up and erasing
        buffer += eraseLines(op.count);
        break;

      case 'clearTerminal':
        // Clear entire terminal screen
        buffer += getClearSequence();
        break;

      case 'cursorHide':
        buffer += ANSI.CURSOR_HIDE;
        break;

      case 'cursorShow':
        buffer += ANSI.CURSOR_SHOW;
        break;

      case 'synchronizedUpdateStart':
        buffer += ANSI.SYNC_START;
        break;

      case 'synchronizedUpdateEnd':
        buffer += ANSI.SYNC_END;
        break;
    }
  }

  // Flush remaining buffer
  if (buffer) {
    terminal.stdout.write(buffer);
  }
}

/**
 * Count how many terminal lines a string will occupy at given width
 *
 * Accounts for:
 * - Newlines (\n)
 * - Word wrapping (display width vs terminal width)
 *
 * @param text - Text to count lines for
 * @param terminalWidth - Terminal width in columns
 * @returns Number of terminal lines the text will occupy
 */
export function countTerminalLines(text: string, terminalWidth: number): number {
  if (!text) return 0;
  if (terminalWidth <= 0) {
    return text.split('\n').length;
  }

  // For simplicity, we'll count actual newlines
  // In a full implementation, you'd use a display width library
  // to account for ANSI codes and multi-byte characters
  const lines = text.split('\n');
  let totalLines = 0;

  for (const line of lines) {
    // Strip ANSI codes for width calculation (simple regex)
    // eslint-disable-next-line no-control-regex
    const strippedLine = line.replace(/\u001B\[[0-9;]*m/g, '');
    const lineWidth = strippedLine.length;

    if (lineWidth === 0) {
      totalLines += 1;
    } else {
      totalLines += Math.ceil(lineWidth / terminalWidth);
    }
  }

  return totalLines;
}
