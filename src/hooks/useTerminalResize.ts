/**
 * useTerminalResize - Handles terminal resize events
 *
 * Listens for terminal resize and triggers callback with new dimensions
 */

import { useEffect, useRef } from 'react';
import { logger } from '../lib/logger.js';
import { CustomRenderLogger, type RenderFrame } from '../lib/custom-logger.js';
import { executeTerminalOperations, type Terminal } from '../lib/terminal-ops.js';

interface UseTerminalResizeOptions {
  renderLogger: CustomRenderLogger | null;
  renderFooter: () => string;
}

export function useTerminalResize({
  renderLogger,
  renderFooter,
}: UseTerminalResizeOptions): void {
  // Track previous values
  const prevTerminalWidthRef = useRef(process.stdout.columns ?? 80);
  const prevTerminalRowsRef = useRef(process.stdout.rows ?? 24);

  // Store latest renderFooter in ref so resize handler always has current version
  const renderFooterRef = useRef(renderFooter);
  useEffect(() => {
    renderFooterRef.current = renderFooter;
  }, [renderFooter]);

  // Handle terminal resize
  useEffect(() => {
    const handleResize = () => {
      if (!renderLogger) return;

      const newWidth = process.stdout.columns ?? 80;
      const newRows = process.stdout.rows ?? 24;

      if (
        newWidth !== prevTerminalWidthRef.current ||
        newRows !== prevTerminalRowsRef.current
      ) {
        logger.debug('[useTerminalResize] Terminal resize - triggering full redraw', {
          oldWidth: prevTerminalWidthRef.current,
          newWidth,
          oldRows: prevTerminalRowsRef.current,
          newRows,
        });

        // Render footer at new width using latest renderFooter
        const footerOutput = renderFooterRef.current();

        logger.debug('[useTerminalResize] Footer rendered', {
          footerLength: footerOutput.length,
          columnsInFrame: newWidth,
        });

        // Create frame with NO new static output (triggers full redraw in logger)
        const frame: RenderFrame = {
          staticOutput: '', // Empty! Logger will use fullStaticOutput
          dynamicOutput: footerOutput,
          columns: newWidth,
          rows: newRows,
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

        prevTerminalWidthRef.current = newWidth;
        prevTerminalRowsRef.current = newRows;
      }
    };

    process.stdout.on('resize', handleResize);

    return () => {
      process.stdout.off('resize', handleResize);
    };
  }, [renderLogger]);
}
