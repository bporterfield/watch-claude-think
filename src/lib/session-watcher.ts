import chokidar, { type FSWatcher } from 'chokidar';
import PQueue from 'p-queue';
import { extractSessionInfo } from './parser.js';
import { logger } from './logger.js';
import {
  FILE_OPERATION_QUEUE_CONCURRENCY,
  WATCHER_STABILITY_THRESHOLD,
  WATCHER_POLL_INTERVAL,
  BYTES_TO_MB,
} from './constants.js';

/**
 * Callbacks for session watcher events
 */
export interface SessionWatcherCallbacks {
  onChange: (filePath: string) => void;
  onNewSession?: (newFilePath: string) => void;
}

/**
 * Session file watcher
 *
 * Whether watching a single session or all sessions, we always use directory watching.
 * The difference is just which files we filter for in the change events.
 *
 * Benefits:
 * - No race conditions between file and directory watchers
 * - Single watcher to manage
 * - Handles new session detection naturally
 * - Same code path for both single and multi-session modes
 */
export class SessionWatcher {
  private watcher: FSWatcher;
  private projectPath: string;
  private watchedFiles: Set<string> = new Set();
  private callbacks: SessionWatcherCallbacks;
  private queue: PQueue;
  private readyPromise: Promise<void>;

  constructor(projectPath: string, initialFiles: string[], callbacks: SessionWatcherCallbacks) {
    this.projectPath = projectPath;
    this.callbacks = callbacks;

    logger.info('[SessionWatcher] Creating watcher', {
      projectPath,
      fileCount: initialFiles.length,
      isSingleSession: initialFiles.length === 1,
    });

    // Track files we care about
    initialFiles.forEach((file) => this.watchedFiles.add(file));

    // Create async queue to serialize file operations and prevent race conditions
    this.queue = new PQueue({ concurrency: FILE_OPERATION_QUEUE_CONCURRENCY });

    // Always watch the project directory
    // This handles both file changes and new file detection (compaction/new sessions)
    this.watcher = chokidar.watch(projectPath, {
      persistent: true,
      ignoreInitial: true,
      depth: 0, // Only watch files directly in this directory
      awaitWriteFinish: {
        stabilityThreshold: WATCHER_STABILITY_THRESHOLD,
        pollInterval: WATCHER_POLL_INTERVAL,
      },
    });

    // Create promise that resolves when watcher is ready
    this.readyPromise = new Promise<void>((resolve) => {
      this.watcher.on('ready', () => {
        logger.debug('[SessionWatcher] Watcher ready');
        resolve();
      });
    });

    // Handle file changes
    this.watcher.on('change', (changedPath) => {
      // Filter: only care about .jsonl files we're watching
      if (!changedPath.endsWith('.jsonl') || !this.watchedFiles.has(changedPath)) {
        return;
      }

      logger.debug('[SessionWatcher] File changed', { changedPath });

      void this.queue.add(async () => {
        try {
          callbacks.onChange(changedPath);
        } catch (error) {
          logger.error('Error handling file change in queue', {
            filePath: changedPath,
            error,
          });
        }
      });
    });

    // Handle new session files
    this.watcher.on('add', (newFilePath) => {
      // Only process .jsonl files
      if (!newFilePath.endsWith('.jsonl')) {
        return;
      }

      // Skip files we already know about
      if (this.watchedFiles.has(newFilePath)) {
        return;
      }

      logger.debug('[SessionWatcher] New file detected', { newFilePath });

      void this.queue.add(async () => {
        try {
          await this.handleNewFile(newFilePath);
        } catch (error) {
          logger.error('Error handling new file in queue', {
            filePath: newFilePath,
            error,
          });
        }
      });
    });
  }

  /**
   * Handle new file detection (new sessions)
   *
   * A new .jsonl file is always a new session, either from:
   * 1. User running `claude` command (may auto-resume with summary)
   * 2. User typing `/new` or `/resume` command
   */
  private async handleNewFile(newFilePath: string): Promise<void> {
    logger.debug('[SessionWatcher] Processing new file', { newFilePath });

    // If we have a new session callback, call it
    // All new .jsonl files are new sessions (compaction doesn't create files)
    if (this.callbacks.onNewSession) {
      try {
        const sessionInfo = await extractSessionInfo(newFilePath);

        logger.debug('[SessionWatcher] Detected new session', {
          newFilePath,
          sessionName: sessionInfo.sessionName,
          hasLeafUuid: sessionInfo.leafUuid !== null,
        });

        this.callbacks.onNewSession(newFilePath);
      } catch (error) {
        // Ignore errors reading the new file - it might not be fully written yet
        logger.debug('[SessionWatcher] Failed to read new file (may still be writing)', {
          filePath: newFilePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      logger.debug('[SessionWatcher] No new session callback registered', {
        newFilePath,
      });
    }
  }

  /**
   * Add a new file to the watch list
   * Used when SessionManager registers a new session
   */
  addFile(filePath: string): void {
    logger.debug('[SessionWatcher] Adding file to watch list', { filePath });
    this.watchedFiles.add(filePath);
  }

  /**
   * Remove a file from the watch list
   */
  removeFile(filePath: string): void {
    logger.debug('[SessionWatcher] Removing file from watch list', { filePath });
    this.watchedFiles.delete(filePath);
  }

  /**
   * Wait for the watcher to be ready
   * Must be called before the watcher will detect file changes
   */
  async waitForReady(): Promise<void> {
    await this.readyPromise;
  }

  /**
   * Wait for all pending queue operations to complete
   * Useful for testing to ensure all events have been processed
   */
  async waitForIdle(): Promise<void> {
    await this.queue.onIdle();
  }

  /**
   * Clean up watcher
   */
  async close(): Promise<void> {
    const memBefore = process.memoryUsage();
    logger.info('[SessionWatcher] Starting close', {
      watchedFileCount: this.watchedFiles.size,
      heapUsedMB: Math.round(memBefore.heapUsed / BYTES_TO_MB),
    });

    // Close watcher
    try {
      await this.watcher.close();
      logger.debug('[SessionWatcher] Chokidar watcher closed');
    } catch (error) {
      logger.error('Error closing watcher', error);
    }

    // Wait for any pending queue operations to complete
    try {
      await this.queue.onIdle();
      logger.debug('[SessionWatcher] Queue drained');
    } catch (error) {
      logger.error('Error waiting for queue to drain', error);
    }

    // Clear tracked files
    this.watchedFiles.clear();

    const memAfter = process.memoryUsage();
    logger.info('[SessionWatcher] Closed', {
      heapUsedMB: Math.round(memAfter.heapUsed / BYTES_TO_MB),
      heapDeltaMB: Math.round((memAfter.heapUsed - memBefore.heapUsed) / BYTES_TO_MB),
    });
  }
}
