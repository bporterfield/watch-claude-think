/**
 * StreamView - Custom Rendering Pipeline
 * Uses direct terminal operations instead of Ink's rendering
 * for maximum performance with thousands of messages
 */

import React, { useMemo, useCallback } from 'react';
import { Box } from 'ink';
import { assignSessionColors, getProjectColor } from '../lib/colors.js';
import { renderFooterToString } from '../lib/footer-renderer.js';
import { DEFAULT_TERMINAL_WIDTH, DEFAULT_TERMINAL_HEIGHT } from '../lib/constants.js';
import type { ChalkInstance } from 'chalk';
import type { DisplayMessageBlock } from '../services/message-store.js';
import type { SessionFile } from '../services/session-manager.js';

// Hooks
import { useSessionServices } from '../hooks/useSessionServices.js';
import { useCustomRenderer } from '../hooks/useCustomRenderer.js';
import { useKeyboardInput } from '../hooks/useKeyboardInput.js';
import { useTerminalResize } from '../hooks/useTerminalResize.js';

interface StreamViewProps {
  sessionFiles: SessionFile[];
  onBack?: () => void;
}

export const StreamView: React.FC<StreamViewProps> = ({ sessionFiles, onBack }) => {
  // Display calculations
  const isSingleSession = sessionFiles.length === 1;
  const singleSessionInfo = isSingleSession ? sessionFiles[0] : null;

  const firstProject = sessionFiles[0];
  const isWatchingAllForProject =
    !isSingleSession &&
    sessionFiles.length > 0 &&
    firstProject &&
    sessionFiles.every((s) => s.projectName === firstProject.projectName);
  const projectName = firstProject?.projectName;

  // Create unique session color mapping, excluding the project's color
  const sessionColorMap = useMemo(() => {
    const sessionPaths = sessionFiles.map((s) => s.sessionPath);
    const projectColor = projectName ? getProjectColor(projectName) : undefined;
    return assignSessionColors(sessionPaths, projectColor);
  }, [sessionFiles, projectName]);

  // Helper to get color for a message block
  const getSessionColor = useCallback(
    (block: DisplayMessageBlock): ChalkInstance | undefined => {
      // Use sessionPath for consistent color lookup (session names can change dynamically)
      return block.sessionPath ? sessionColorMap.get(block.sessionPath) : undefined;
    },
    [sessionColorMap],
  );

  // Render footer to string
  const renderFooter = useCallback((): string => {
    return renderFooterToString({
      isSingleSession,
      isWatchingAllForProject: isWatchingAllForProject ?? false,
      projectName,
      sessionName: singleSessionInfo?.sessionName,
      showBack: !!onBack,
      terminalWidth: process.stdout.columns ?? DEFAULT_TERMINAL_WIDTH,
    });
  }, [isSingleSession, isWatchingAllForProject, projectName, singleSessionInfo, onBack]);

  // Memoize initial render frame to avoid recreating on every render
  const initialRenderFrame = useMemo(
    () => ({
      staticOutput: '',
      dynamicOutput: renderFooter(),
      columns: process.stdout.columns ?? DEFAULT_TERMINAL_WIDTH,
      rows: process.stdout.rows ?? DEFAULT_TERMINAL_HEIGHT,
    }),
    [renderFooter],
  );

  // Initialize services
  const { messageBlocks, renderLogger } = useSessionServices({
    sessionFiles,
    initialRenderFrame,
  });

  // Handle rendering
  useCustomRenderer({
    messageBlocks,
    renderLogger,
    renderFooter,
    getSessionColor,
    isSingleSession,
    isWatchingAllForProject: isWatchingAllForProject ?? false,
  });

  // Handle keyboard input
  useKeyboardInput({ onBack });

  // Handle terminal resize
  useTerminalResize({ renderLogger, renderFooter });

  // Return minimal Ink component (just for keyboard handling)
  return <Box />;
};
