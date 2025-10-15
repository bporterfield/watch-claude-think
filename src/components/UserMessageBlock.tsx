import React, { useMemo } from 'react';
import { Box, Text, useStdout } from 'ink';
import { Marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import chalk, { type ChalkInstance } from 'chalk';
import { getProjectColor } from '../lib/colors.js';
import { getMarkedTerminalConfig } from '../lib/markdown-config.js';
import {
  MIN_CONTENT_WIDTH,
  CONTENT_LEFT_PADDING,
  DEFAULT_TERMINAL_WIDTH,
} from '../lib/constants.js';

interface UserMessageBlockProps {
  content: string;
  timestamp: string;
  projectName?: string;
  sessionName?: string;
  showSessionInfo?: boolean;
  showProjectName?: boolean;
  sessionColor?: ChalkInstance; // Optional color override for multi-session view
}

const UserMessageBlockComponent: React.FC<UserMessageBlockProps> = ({
  content,
  timestamp,
  projectName,
  sessionName,
  showSessionInfo = true,
  showProjectName = true,
  sessionColor,
}) => {
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns ?? DEFAULT_TERMINAL_WIDTH;

  const formatTimestamp = (ts: string) => {
    const date = new Date(ts);
    return date.toLocaleTimeString();
  };

  // Use session color if provided (for multi-session views), otherwise fall back to project color
  const displayColor = sessionColor
    ? sessionColor
    : projectName
      ? getProjectColor(projectName)
      : chalk.white;

  // Configure marked with terminal width for proper text wrapping
  // Account for left padding
  const contentWidth = Math.max(MIN_CONTENT_WIDTH, terminalWidth - CONTENT_LEFT_PADDING);

  // Create marked parser instance, only when width changes
  const parser = useMemo(() => {
    const p = new Marked();
    // @ts-expect-error - @types/marked-terminal@6.1.1 types are for marked v11, we're using v15
    p.use(markedTerminal(getMarkedTerminalConfig(contentWidth)));
    return p;
  }, [contentWidth]);

  // Parse markdown with width-aware configuration
  const renderedMarkdown = useMemo(
    () => (parser.parse(content) as string).trim(),
    [parser, content],
  );

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box marginBottom={1}>
        <Text dimColor>{formatTimestamp(timestamp)} </Text>
        {showSessionInfo && (showProjectName ? projectName : sessionName) && (
          <Text>
            {displayColor('[')}
            {showProjectName && projectName && (
              <>
                {displayColor(projectName)}
                {sessionName && displayColor(' / ')}
              </>
            )}
            {sessionName && displayColor(sessionName)}
            {displayColor(']')}
          </Text>
        )}
        <Text bold color="blue">
          {' '}
          User:
        </Text>
      </Box>
      <Box paddingLeft={CONTENT_LEFT_PADDING} flexDirection="column">
        <Text wrap="wrap">{renderedMarkdown}</Text>
      </Box>
    </Box>
  );
};

export const UserMessageBlock = React.memo(UserMessageBlockComponent);
