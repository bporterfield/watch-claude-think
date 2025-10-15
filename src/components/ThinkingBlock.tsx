import React, { useMemo } from "react";
import { Box, Text, useStdout } from "ink";
import { Marked } from "marked";
import { markedTerminal } from "marked-terminal";
import chalk, { type ChalkInstance } from "chalk";
import { getProjectColor } from "../lib/colors.js";
import { getMarkedTerminalConfig } from "../lib/markdown-config.js";

interface ThinkingBlockProps {
  thinking: string;
  timestamp: string;
  projectName?: string;
  sessionName?: string;
  showSessionInfo?: boolean;
  showProjectName?: boolean;
  sessionColor?: ChalkInstance; // Optional color override for multi-session view
}

const ThinkingBlockComponent: React.FC<ThinkingBlockProps> = ({
  thinking,
  timestamp,
  projectName,
  sessionName,
  showSessionInfo = true,
  showProjectName = true,
  sessionColor,
}) => {
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns ?? 80;

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
  // Account for left padding (2 spaces)
  const contentWidth = Math.max(40, terminalWidth - 2);

  // Create marked parser instance, only when width changes
  const parser = useMemo(() => {
    const p = new Marked();
    // @ts-expect-error - @types/marked-terminal@6.1.1 types are for marked v11, we're using v15
    p.use(markedTerminal(getMarkedTerminalConfig(contentWidth)));
    return p;
  }, [contentWidth]);

  // Parse markdown with width-aware configuration
  const renderedMarkdown = useMemo(() =>
    (parser.parse(thinking) as string).trim(),
    [parser, thinking]
  );

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box marginBottom={1}>
        <Text dimColor>{formatTimestamp(timestamp)} </Text>
        {showSessionInfo && (showProjectName ? projectName : sessionName) && (
          <Text>
            {displayColor("[")}
            {showProjectName && projectName && (
              <>
                {displayColor(projectName)}
                {sessionName && displayColor(" / ")}
              </>
            )}
            {sessionName && displayColor(sessionName)}
            {displayColor("]")}
          </Text>
        )}
        <Text bold color="#D97857"> Claude:</Text>
      </Box>
      <Box paddingLeft={2} flexDirection="column">
        <Text wrap="wrap">{renderedMarkdown}</Text>
      </Box>
    </Box>
  );
};

export const ThinkingBlock = React.memo(ThinkingBlockComponent);
