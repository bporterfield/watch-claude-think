import { parseNewLines, parseFileTail, extractSessionInfo } from '../lib/parser.js';
import type { DisplayMessageBlock } from './message-store.js';
import { logger } from '../lib/logger.js';
import { SessionWatcher } from '../lib/session-watcher.js';
import { FILE_TAIL_BYTES, MAX_BLOCKS_INITAL_RENDER, BYTES_TO_MB } from '../lib/constants.js';

/**
 * Session file information
 */
export interface SessionFile {
  projectName: string;
  projectPath: string;
  sessionPath: string;
  sessionName: string;
}

/**
 * Event emitted when new messages are parsed
 */
export interface NewMessagesEvent {
  messages: DisplayMessageBlock[];
  source: 'change' | 'new-session' | 'initial';
}

/**
 * Event emitted when an error occurs
 */
export interface SessionErrorEvent {
  type: 'registration-failed' | 'extraction-failed' | 'parse-error';
  filePath: string;
  error: unknown;
  recoverable: boolean;
}

/**
 * Callback types
 */
export type NewMessagesCallback = (event: NewMessagesEvent) => void;
export type ErrorCallback = (event: SessionErrorEvent) => void;

/**
 * Service for managing file watching and message parsing
 *
 * Responsibilities:
 * - Watch session files for changes
 * - Parse new content incrementally
 * - Detect and handle new sessions (when watching all)
 * - Emit events when new messages arrive
 */
export class SessionManager {
  private sessionFiles: SessionFile[];
  private sessionFilesMap: Map<
    string,
    { projectName: string; sessionName: string; summaryIdInUse: string | null }
  >;
  private watcher: SessionWatcher | null = null;
  private newMessagesListeners = new Set<NewMessagesCallback>();
  private errorListeners = new Set<ErrorCallback>();
  private projectName: string; // The project selected by the user
  private projectPath: string; // The project directory path

  constructor(sessionFiles: SessionFile[], projectName: string, projectPath: string) {
    this.sessionFiles = sessionFiles;
    this.sessionFilesMap = new Map(
      sessionFiles.map((s) => [
        s.sessionPath,
        { projectName: s.projectName, sessionName: s.sessionName, summaryIdInUse: null },
      ]),
    );

    // Store the project name and path that the user selected
    this.projectName = projectName;
    this.projectPath = projectPath;
  }

  /**
   * Initialize the manager - parse existing content and start watching
   */
  async initialize(): Promise<void> {
    // Parse existing content on mount
    const messages: DisplayMessageBlock[] = [];

    logger.debug('[SessionManager] Loading initial messages', {
      sessionCount: this.sessionFiles.length,
      bytesPerFile: FILE_TAIL_BYTES,
    });

    // Load normal amount from each session (FILE_TAIL_BYTES)
    for (const { sessionPath, projectName, sessionName } of this.sessionFiles) {
      try {
        const sessionBlocks = await parseFileTail(sessionPath, FILE_TAIL_BYTES);

        for (const block of sessionBlocks) {
          messages.push({ ...block, projectName, sessionName, sessionPath });
        }
      } catch (error) {
        logger.error('Failed to parse initial messages from session', {
          sessionPath,
          error,
        });

        // Emit error event for UI handling
        this.notifyError({
          type: 'parse-error',
          filePath: sessionPath,
          error,
          recoverable: true, // Continue loading other sessions
        });
      }
    }

    if (messages.length > 0) {
      // Sort by timestamp
      messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      // Cap to MAX_BLOCKS_INITAL_RENDER to avoid loading thousands of messages
      // Keep the most recent messages
      const cappedMessages =
        messages.length > MAX_BLOCKS_INITAL_RENDER
          ? messages.slice(-MAX_BLOCKS_INITAL_RENDER)
          : messages;

      logger.debug('[SessionManager] Initial messages loaded', {
        totalParsed: messages.length,
        afterCap: cappedMessages.length,
        capped: messages.length > MAX_BLOCKS_INITAL_RENDER,
      });

      // Emit initial messages
      this.notifyNewMessages({
        messages: cappedMessages,
        source: 'initial',
      });
    }

    // Start watching files
    this.startWatching();
  }

  /**
   * Start watching files for changes
   */
  private startWatching(): void {
    const filePaths = this.sessionFiles.map((s) => s.sessionPath);
    const isSingleSession = filePaths.length === 1;

    logger.info('[SessionManager] Starting file watching', {
      projectPath: this.projectPath,
      mode: isSingleSession ? 'single-session' : 'all-sessions',
      fileCount: filePaths.length,
    });

    // Always use the unified SessionWatcher - it uses directory watching for both modes
    // The difference is just which files we filter for and whether we enable onNewSession
    this.watcher = new SessionWatcher(this.projectPath, filePaths, {
      onChange: async (changedPath) => {
        await this.handleFileChange(changedPath);
      },
      // Only enable new session detection when watching all sessions
      onNewSession: isSingleSession
        ? undefined
        : async (newFilePath) => {
            await this.handleNewSession(newFilePath);
          },
    });
  }

  /**
   * Register a new session (extract info, add to map, add to watcher)
   * Shared logic used by both handleFileChange and handleNewSession
   *
   * Uses the project name that was selected by the user (stored in this.projectName)
   */
  private async registerNewSession(filePath: string): Promise<
    | {
        projectName: string;
        sessionName: string;
        summaryIdInUse: string | null;
      }
    | undefined
  > {
    try {
      const sessionInfo = await extractSessionInfo(filePath);

      logger.debug('[SessionManager] Extracted session info', {
        filePath,
        sessionName: sessionInfo.sessionName,
        cwd: sessionInfo.cwd,
        leafUuid: sessionInfo.leafUuid,
        summaryIdInUse: sessionInfo.summaryIdInUse,
      });

      // Use the project name that was selected by the user
      // All new sessions discovered belong to this project
      const newSession = {
        projectName: this.projectName,
        sessionName: sessionInfo.sessionName,
        summaryIdInUse: sessionInfo.summaryIdInUse,
      };
      this.sessionFilesMap.set(filePath, newSession);

      // Add to watcher so we track changes to this file
      if (this.watcher) {
        logger.debug('[SessionManager] Adding file to watcher', {
          filePath,
          sessionName: sessionInfo.sessionName,
        });
        this.watcher.addFile(filePath);
      }

      logger.debug('[SessionManager] Registered new session', {
        filePath,
        sessionName: sessionInfo.sessionName,
        projectName: this.projectName,
        summaryIdInUse: sessionInfo.summaryIdInUse,
        totalSessions: this.sessionFilesMap.size,
      });

      return newSession;
    } catch (error) {
      logger.warn('Could not register new session', {
        filePath,
        error,
      });

      // Emit error event for UI handling
      this.notifyError({
        type: 'registration-failed',
        filePath,
        error,
        recoverable: true, // Operation continues without this session
      });

      return undefined;
    }
  }

  /**
   * Handle file change event
   */
  private async handleFileChange(changedPath: string): Promise<void> {
    let sessionInfo = this.sessionFilesMap.get(changedPath);

    // If we don't have session info yet, the file might be brand new
    // This can happen if a file changes before we register it via onNewSession
    if (!sessionInfo) {
      logger.info('File change detected for unknown session, registering', {
        changedPath,
      });

      sessionInfo = await this.registerNewSession(changedPath);
      if (!sessionInfo) {
        return;
      }
    }

    // Parse new messages first so we can check their parentUuids
    let newBlocks;
    try {
      newBlocks = await parseNewLines(changedPath);
    } catch (error) {
      logger.error('Failed to parse new lines from file', { changedPath, error });

      // Emit error event for UI handling
      this.notifyError({
        type: 'parse-error',
        filePath: changedPath,
        error,
        recoverable: true, // We'll try again on next change
      });

      return; // Can't proceed without parsed blocks
    }

    // Check if we need to re-extract the session name
    // Condition 1: Session is unnamed (no user message existed when first extracted)
    const isUnnamed = sessionInfo.sessionName === 'Unnamed session';

    // Condition 2: New user message points to a different summary ID
    // Check if any new user message's parentUuid differs from our tracked summaryIdInUse
    const hasDifferentSummaryId = newBlocks.some((block) => {
      if (block.type === 'user') {
        // If parentUuid is not null and differs from our summaryIdInUse, we might have a new summary
        return block.parentUuid !== null && block.parentUuid !== sessionInfo.summaryIdInUse;
      }
      return false;
    });

    const shouldReExtract = isUnnamed || hasDifferentSummaryId;

    if (shouldReExtract) {
      try {
        const extracted = await extractSessionInfo(changedPath);

        // Update if anything has changed
        if (
          extracted.sessionName !== sessionInfo.sessionName ||
          extracted.summaryIdInUse !== sessionInfo.summaryIdInUse
        ) {
          logger.info('Updating session info', {
            changedPath,
            reason: isUnnamed ? 'was unnamed' : 'different summary ID detected',
            oldName: sessionInfo.sessionName,
            newName: extracted.sessionName,
            oldSummaryId: sessionInfo.summaryIdInUse,
            newSummaryId: extracted.summaryIdInUse,
          });

          sessionInfo.sessionName = extracted.sessionName;
          sessionInfo.summaryIdInUse = extracted.summaryIdInUse;
          this.sessionFilesMap.set(changedPath, sessionInfo);
        }
      } catch (error) {
        logger.debug('Could not update session name', { changedPath, error });

        // Emit error event for UI handling
        this.notifyError({
          type: 'extraction-failed',
          filePath: changedPath,
          error,
          recoverable: true, // We continue with the old session name
        });
      }
    }

    if (newBlocks.length > 0) {
      const messages: DisplayMessageBlock[] = newBlocks.map((b) => ({
        ...b,
        projectName: sessionInfo.projectName,
        sessionName: sessionInfo.sessionName,
        sessionPath: changedPath,
      }));

      this.notifyNewMessages({
        messages,
        source: 'change',
      });
    }
  }

  /**
   * Handle new session event (when watching all sessions)
   */
  private async handleNewSession(newFilePath: string): Promise<void> {
    logger.debug('[SessionManager] handleNewSession called', { newFilePath });

    // Register the new session (extract info, add to map, add to watcher)
    const sessionInfo = await this.registerNewSession(newFilePath);
    if (!sessionInfo) {
      return;
    }

    logger.info('[SessionManager] New session detected', {
      filePath: newFilePath,
      projectName: sessionInfo.projectName,
      sessionName: sessionInfo.sessionName,
    });

    // Parse the new file (use tail for memory efficiency)
    let newBlocks;
    try {
      newBlocks = await parseFileTail(newFilePath);
    } catch (error) {
      logger.error('Failed to parse new session file', { newFilePath, error });

      // Emit error event for UI handling
      this.notifyError({
        type: 'parse-error',
        filePath: newFilePath,
        error,
        recoverable: true, // New session will be retried on next change
      });

      return; // Can't proceed without parsed blocks
    }

    logger.debug('[SessionManager] Parsed new session file', {
      newFilePath,
      blockCount: newBlocks.length,
    });

    if (newBlocks.length > 0) {
      const messages: DisplayMessageBlock[] = newBlocks.map((b) => ({
        ...b,
        projectName: sessionInfo.projectName,
        sessionName: sessionInfo.sessionName,
        sessionPath: newFilePath,
      }));

      logger.debug('[SessionManager] Notifying listeners of new session messages', {
        newFilePath,
        messageCount: messages.length,
      });

      this.notifyNewMessages({
        messages,
        source: 'new-session',
      });
    } else {
      logger.debug('[SessionManager] No messages in new session file yet', { newFilePath });
    }
  }

  /**
   * Subscribe to new messages events
   */
  onNewMessages(callback: NewMessagesCallback): () => void {
    this.newMessagesListeners.add(callback);
    return () => {
      this.newMessagesListeners.delete(callback);
    };
  }

  /**
   * Subscribe to error events
   */
  onError(callback: ErrorCallback): () => void {
    this.errorListeners.add(callback);
    return () => {
      this.errorListeners.delete(callback);
    };
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    const memBefore = process.memoryUsage();
    logger.info('[SessionManager] Starting cleanup', {
      sessionCount: this.sessionFilesMap.size,
      listenerCount: this.newMessagesListeners.size,
      heapUsedMB: Math.round(memBefore.heapUsed / BYTES_TO_MB),
    });

    if (this.watcher) {
      try {
        await this.watcher.close();
        logger.debug('[SessionManager] Watcher closed');
      } catch (error) {
        logger.error('Error closing file watcher', error);
      }
      this.watcher = null;
    }

    try {
      this.newMessagesListeners.clear();
      this.errorListeners.clear();
      logger.debug('[SessionManager] Listeners cleared');
    } catch (error) {
      logger.error('Error clearing listeners', error);
    }

    try {
      this.sessionFilesMap.clear();
      logger.debug('[SessionManager] Session files map cleared');
    } catch (error) {
      logger.error('Error clearing session files map', error);
    }

    const memAfter = process.memoryUsage();
    logger.info('[SessionManager] Cleanup complete', {
      heapUsedMB: Math.round(memAfter.heapUsed / BYTES_TO_MB),
      heapDeltaMB: Math.round((memAfter.heapUsed - memBefore.heapUsed) / BYTES_TO_MB),
    });
  }

  /**
   * Notify new messages listeners
   */
  private notifyNewMessages(event: NewMessagesEvent): void {
    for (const listener of this.newMessagesListeners) {
      listener(event);
    }
  }

  /**
   * Notify error listeners
   */
  private notifyError(event: SessionErrorEvent): void {
    for (const listener of this.errorListeners) {
      listener(event);
    }
  }
}
