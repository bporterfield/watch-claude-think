/**
 * Footer Renderer
 * Renders footer as plain text (no Ink components)
 * for use with custom rendering pipeline
 *
 * Matches the original Footer.tsx component styling exactly
 */

import chalk from 'chalk';
import stripAnsi from 'strip-ansi';
import { getProjectColor } from './colors.js';
import { CURSOR_WIDTH } from './constants.js';

export interface FooterOptions {
  isSingleSession: boolean;
  isWatchingAllForProject: boolean;
  projectName?: string;
  sessionName?: string;
  showBack: boolean;
  terminalWidth: number;
  alwaysThinkingEnabled: boolean;
}

/**
 * Render footer as plain text string
 *
 * Format (matches Footer.tsx):
 * - Divider line (dim ─ characters)
 * - Bold text: <colored_project_name> / <session_name or "All Sessions">
 * - Dim text: "ESC to go back | Ctrl+C to exit"
 *
 * @param options - Footer rendering options
 * @returns Plain text footer string
 */
export function renderFooterToString(options: FooterOptions): string {
  const {
    isSingleSession,
    isWatchingAllForProject,
    projectName,
    sessionName,
    showBack,
    terminalWidth,
    alwaysThinkingEnabled,
  } = options;

  const lines: string[] = [];
  const leftPadding = ' '.repeat(CURSOR_WIDTH);

  // Skip footer if not showing single session or all sessions for a project
  if (!isSingleSession && !isWatchingAllForProject) {
    if (showBack) {
      return leftPadding + chalk.dim('ESC to go back | Ctrl+C to exit');
    }
    return '';
  }

  if (!projectName) return '';

  // Add blank line (margin top)
  lines.push('');

  // Divider line (dim ─ characters) - NO PADDING, full width
  const divider = chalk.dim('─'.repeat(Math.max(0, terminalWidth)));
  lines.push(divider);

  // Project/Session info line (bold) - WITH PADDING
  let infoLine = '';
  if (isSingleSession && sessionName) {
    // Single session: "ProjectName / session-name"
    infoLine =
      leftPadding + chalk.bold(getProjectColor(projectName)(projectName) + ' / ' + sessionName);
  } else {
    // All sessions: "ProjectName / All Sessions"
    infoLine =
      leftPadding + chalk.bold(getProjectColor(projectName)(projectName) + ' / All Sessions');
  }
  lines.push(infoLine);

  // Navigation instructions (dim) - WITH PADDING
  if (showBack) {
    // Build navigation line with thinking mode status
    // We need to apply dim selectively to keep the colors vibrant
    let navLine = leftPadding + chalk.dim('ESC to go back | Ctrl+C to exit | thinking: ');

    if (alwaysThinkingEnabled) {
      navLine += chalk.green('on') + chalk.dim(' for new Claude instances');
    } else {
      navLine += chalk.red('off') + chalk.dim(' for new Claude instances (Tab in claude toggle)');
    }

    // Truncate if needed to prevent wrapping
    const visibleLength = stripAnsi(navLine).length;
    if (visibleLength > terminalWidth) {
      // We need to truncate - rebuild the line to fit within terminal width
      // Keep the essential parts and truncate the end gracefully
      const baseText = leftPadding + chalk.dim('ESC to go back | Ctrl+C to exit | thinking: ');
      const baseLength = stripAnsi(baseText).length;
      const remainingSpace = terminalWidth - baseLength;

      if (remainingSpace > 10) {
        // Enough space for status - build shorter version
        if (alwaysThinkingEnabled) {
          navLine = baseText + chalk.green('on') + chalk.dim(' for new Claude...');
        } else {
          navLine = baseText + chalk.red('off') + chalk.dim(' for new Claude...');
        }
      } else if (remainingSpace > 3) {
        // Very tight - just show on/off
        navLine = baseText + (alwaysThinkingEnabled ? chalk.green('on') : chalk.red('off'));
      } else {
        // Terminal too narrow - skip thinking status entirely
        navLine = leftPadding + chalk.dim('ESC | Ctrl+C to exit');
      }
    }

    lines.push(navLine);
  }

  return lines.join('\n');
}
