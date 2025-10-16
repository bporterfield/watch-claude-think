/**
 * useCustomRenderer - Handles terminal rendering operations
 *
 * Takes message blocks and renders them to the terminal using CustomRenderLogger
 */

import { useEffect, useRef } from 'react';
import { renderBlockToString } from '../lib/block-renderer.js';
import { CustomRenderLogger, type RenderFrame } from '../lib/custom-logger.js';
import { executeTerminalOperations, type Terminal } from '../lib/terminal-ops.js';
import type { DisplayMessageBlock } from '../services/message-store.js';
import type { ChalkInstance } from 'chalk';
import { DEFAULT_TERMINAL_WIDTH, DEFAULT_TERMINAL_HEIGHT } from '../lib/constants.js';

interface UseCustomRendererOptions {
  messageBlocks: DisplayMessageBlock[];
  renderLogger: CustomRenderLogger | null;
  renderFooter: () => string;
  getSessionColor: (block: DisplayMessageBlock) => ChalkInstance | undefined;
  isSingleSession: boolean;
  isWatchingAllForProject: boolean;
}

export function useCustomRenderer({
  messageBlocks,
  renderLogger,
  renderFooter,
  getSessionColor,
  isSingleSession,
  isWatchingAllForProject,
}: UseCustomRendererOptions): void {
  // Track how many blocks we've already rendered
  const staticContentBlockCountRef = useRef(0);

  // Track previous footer to detect changes
  const previousFooterRef = useRef<string>('');

  // Handle footer changes (e.g., settings updates) - re-render footer only
  useEffect(() => {
    if (!renderLogger) return;

    const currentFooter = renderFooter();

    // Skip if footer hasn't changed
    if (currentFooter === previousFooterRef.current) return;

    // Update ref
    previousFooterRef.current = currentFooter;

    // Create frame with no new static content, just updated footer
    const frame: RenderFrame = {
      staticOutput: '',
      dynamicOutput: currentFooter,
      columns: process.stdout.columns ?? DEFAULT_TERMINAL_WIDTH,
      rows: process.stdout.rows ?? DEFAULT_TERMINAL_HEIGHT,
    };

    // Generate operations via logger
    const operations = renderLogger.render(frame);

    // Execute operations
    if (operations.length > 0) {
      const terminal: Terminal = {
        stdout: process.stdout,
        stderr: process.stderr,
      };
      executeTerminalOperations(terminal, operations);
    }
  }, [renderFooter, renderLogger]);

  // Handle new messages - render and write via logger
  useEffect(() => {
    if (!renderLogger) return;

    // Only process new blocks
    if (messageBlocks.length > staticContentBlockCountRef.current) {
      const newBlocks = messageBlocks.slice(staticContentBlockCountRef.current);

      // Render new blocks to string
      const newStaticOutput = newBlocks
        .map((block) => {
          const sessionColor = getSessionColor(block);
          return renderBlockToString(block, {
            terminalWidth: process.stdout.columns ?? DEFAULT_TERMINAL_WIDTH,
            sessionColor,
            showSessionInfo: !isSingleSession,
            showProjectName: !isWatchingAllForProject,
          });
        })
        .join('\n');

      // Create frame with new static content
      const currentFooter = renderFooter();
      const frame: RenderFrame = {
        staticOutput: newStaticOutput,
        dynamicOutput: currentFooter,
        columns: process.stdout.columns ?? DEFAULT_TERMINAL_WIDTH,
        rows: process.stdout.rows ?? DEFAULT_TERMINAL_HEIGHT,
      };

      // Generate operations via logger
      const operations = renderLogger.render(frame);

      // Execute operations
      if (operations.length > 0) {
        const terminal: Terminal = {
          stdout: process.stdout,
          stderr: process.stderr,
        };
        executeTerminalOperations(terminal, operations);
      }

      // Update refs
      staticContentBlockCountRef.current = messageBlocks.length;
      previousFooterRef.current = currentFooter;
    }
  }, [
    messageBlocks,
    renderLogger,
    isSingleSession,
    isWatchingAllForProject,
    getSessionColor,
    renderFooter,
  ]);
}
