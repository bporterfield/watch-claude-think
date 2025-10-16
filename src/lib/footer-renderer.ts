/**
 * Footer Renderer
 * Renders footer as plain text (no Ink components)
 * for use with custom rendering pipeline
 *
 * Matches the original Footer.tsx component styling exactly
 */

import chalk from 'chalk';
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

  // Debug: log terminal width being used
  // Uncomment to debug resize issues:
  // console.error(`[FooterRenderer] Rendering with terminalWidth=${terminalWidth}`);

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
    let navLine = leftPadding + chalk.dim('ESC to go back | Ctrl+C to exit | Thinking mode: ');

    if (alwaysThinkingEnabled) {
      navLine += chalk.green('on');
    } else {
      navLine += chalk.red('off') + chalk.dim(' (press Tab in claude code to turn on)');
    }

    lines.push(navLine);
  }

  return lines.join('\n');
}
