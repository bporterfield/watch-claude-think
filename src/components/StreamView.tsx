/**
 * StreamView - Custom Rendering Pipeline
 * Uses direct terminal operations instead of Ink's rendering
 * for maximum performance with thousands of messages
 */

import React, { useMemo, useCallback, useRef } from 'react';
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
import { useClaudeSettings } from '../hooks/useClaudeSettings.js';

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

  // Store project color for color assignment
  const projectColor = useMemo(
    () => (projectName ? getProjectColor(projectName) : undefined),
    [projectName],
  );

  // Create unique session color mapping, excluding the project's color
  // Use ref so we can mutate it when new sessions are detected
  const sessionColorMapRef = useRef<Map<string, ChalkInstance>>(new Map());

  // Initialize/update the color map when sessionFiles changes
  useMemo(() => {
    const sessionPaths = sessionFiles.map((s) => s.sessionPath);
    const initialColorMap = assignSessionColors(sessionPaths, projectColor);
    sessionColorMapRef.current = initialColorMap;
  }, [sessionFiles, projectColor]);

  // Helper to get color for a message block
  // Dynamically assigns colors to unknown sessions
  const getSessionColor = useCallback(
    (block: DisplayMessageBlock): ChalkInstance | undefined => {
      if (!block.sessionPath) return undefined;

      // Check if we already have a color for this session
      let color = sessionColorMapRef.current.get(block.sessionPath);

      // If not, assign a new color dynamically
      if (!color) {
        // Get all currently assigned session paths
        const existingPaths = Array.from(sessionColorMapRef.current.keys());
        // Create a temporary array with the new path appended
        const allPaths = [...existingPaths, block.sessionPath];
        // Reassign colors to include the new session
        const updatedColorMap = assignSessionColors(allPaths, projectColor);
        // Update our ref with the new color map
        sessionColorMapRef.current = updatedColorMap;
        // Get the color for the new session
        color = updatedColorMap.get(block.sessionPath);
      }

      return color;
    },
    [projectColor],
  );

  // Get Claude settings
  const { alwaysThinkingEnabled } = useClaudeSettings();

  // Render footer to string
  const renderFooter = useCallback((): string => {
    return renderFooterToString({
      isSingleSession,
      isWatchingAllForProject: isWatchingAllForProject ?? false,
      projectName,
      sessionName: singleSessionInfo?.sessionName,
      showBack: !!onBack,
      terminalWidth: process.stdout.columns ?? DEFAULT_TERMINAL_WIDTH,
      alwaysThinkingEnabled: alwaysThinkingEnabled ?? false,
    });
  }, [isSingleSession, isWatchingAllForProject, projectName, singleSessionInfo, onBack, alwaysThinkingEnabled]);

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
