import React from 'react';
import { Box, Text } from 'ink';
import { Divider } from './Divider.js';
import { getProjectColor } from '../lib/colors.js';

interface FooterProps {
  /**
   * Whether this is a single session view or multi-session view.
   */
  isSingleSession?: boolean;

  /**
   * Whether watching all sessions for a single project.
   */
  isWatchingAllForProject?: boolean;

  /**
   * Project name to display.
   */
  projectName?: string;

  /**
   * Session name to display (for single session view).
   */
  sessionName?: string;

  /**
   * Callback when user presses ESC to go back.
   */
  onBack?: () => void;
}

/**
 * Footer component with divider and session/project information.
 *
 * Follows Claude Code's pattern of separating messages from footer
 * with a clean divider line (using Box borders, not text repetition).
 *
 * Structure:
 * - Divider (horizontal line)
 * - Project/Session info
 * - Navigation instructions (ESC to go back, Ctrl+C to exit)
 */
export const Footer: React.FC<FooterProps> = ({
  isSingleSession,
  isWatchingAllForProject,
  projectName,
  sessionName,
  onBack,
}) => {
  // Don't render footer if not showing single session or all sessions for a project
  if (!isSingleSession && !isWatchingAllForProject) {
    // Still show navigation instructions for multi-project view
    if (onBack) {
      return (
        <Box marginTop={1}>
          <Text dimColor>ESC to go back | Ctrl+C to exit</Text>
        </Box>
      );
    }
    return null;
  }

  if (!projectName) return null;

  return (
    <Box flexDirection="column">
      {/* Divider above footer */}
      <Box marginTop={1}>
        <Divider />
      </Box>

      {/* Project/Session info */}
      <Text bold>
        {isSingleSession && sessionName ? (
          <>
            {getProjectColor(projectName)(projectName)}
            {' / '}
            {sessionName}
          </>
        ) : (
          <>
            {getProjectColor(projectName)(projectName)}
            {' / '}
            All Sessions
          </>
        )}
      </Text>

      {/* Navigation instructions */}
      {onBack && <Text dimColor>ESC to go back | Ctrl+C to exit</Text>}
    </Box>
  );
};
