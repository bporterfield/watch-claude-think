/**
 * useSessionServices - Manages service lifecycle for session watching
 *
 * Handles creation, initialization, and cleanup of:
 * - MessageStore
 * - SessionManager
 * - CustomRenderLogger
 */

import { useState, useEffect, useRef } from 'react';
import { logger } from '../lib/logger.js';
import { CustomRenderLogger, type RenderFrame } from '../lib/custom-logger.js';
import { MessageStore, type DisplayMessageBlock } from '../services/message-store.js';
import { SessionManager, type SessionFile } from '../services/session-manager.js';
import { BYTES_TO_MB } from '../lib/constants.js';

interface UseSessionServicesOptions {
  sessionFiles: SessionFile[];
  initialRenderFrame: RenderFrame;
}

interface UseSessionServicesReturn {
  messageBlocks: DisplayMessageBlock[];
  messageStore: MessageStore | null;
  sessionManager: SessionManager | null;
  renderLogger: CustomRenderLogger | null;
}

export function useSessionServices({
  sessionFiles,
  initialRenderFrame,
}: UseSessionServicesOptions): UseSessionServicesReturn {
  // UI state
  const [messageBlocks, setMessageBlocks] = useState<DisplayMessageBlock[]>([]);

  // Services (created once)
  const messageStore = useRef<MessageStore | null>(null);
  const sessionManager = useRef<SessionManager | null>(null);
  const renderLogger = useRef<CustomRenderLogger | null>(null);

  // Initialize services and custom logger
  useEffect(() => {
    let memUsage = process.memoryUsage();
    logger.info('[useSessionServices] Mounting with custom rendering pipeline', {
      sessionCount: sessionFiles.length,
      heapUsedMB: Math.round(memUsage.heapUsed / BYTES_TO_MB),
    });

    const firstSession = sessionFiles[0];
    if (!firstSession) {
      throw new Error('SessionManager requires at least one session file');
    }

    // Create services
    const store = new MessageStore();
    const manager = new SessionManager(
      sessionFiles,
      firstSession.projectName,
      firstSession.projectPath,
    );

    // Create custom logger
    const customLogger = new CustomRenderLogger(
      { isTTY: !!process.stdout.isTTY },
      initialRenderFrame,
    );

    // Save refs
    messageStore.current = store;
    sessionManager.current = manager;
    renderLogger.current = customLogger;

    // Subscribe to message store changes
    const unsubscribeStore = store.subscribe((event) => {
      setMessageBlocks(event.blocks);
    });

    // Subscribe to session manager
    const unsubscribeManager = manager.onNewMessages((event) => {
      store.addBlocks(event.messages);
    });

    // Subscribe to session manager errors
    const unsubscribeErrors = manager.onError((event) => {
      logger.error('[useSessionServices] Session error occurred', {
        type: event.type,
        filePath: event.filePath,
        recoverable: event.recoverable,
        error: event.error,
      });
    });

    // Initialize
    const init = async () => {
      await manager.initialize();
      memUsage = process.memoryUsage();
      logger.info('[useSessionServices] Initialized', {
        heapUsedMB: Math.round(memUsage.heapUsed / BYTES_TO_MB),
      });
    };

    init();

    // Cleanup
    return () => {
      const cleanup = async () => {
        unsubscribeStore();
        unsubscribeManager();
        unsubscribeErrors();
        await manager.cleanup();
        store.clear();
        customLogger.clear();

        messageStore.current = null;
        sessionManager.current = null;
        renderLogger.current = null;
      };
      void cleanup();
    };
  }, [sessionFiles, initialRenderFrame]);

  return {
    messageBlocks,
    messageStore: messageStore.current,
    sessionManager: sessionManager.current,
    renderLogger: renderLogger.current,
  };
}
