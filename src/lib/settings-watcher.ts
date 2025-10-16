import chokidar, { type FSWatcher } from 'chokidar';
import fs from 'fs/promises';
import path from 'path';
import PQueue from 'p-queue';
import { logger } from './logger.js';
import { getClaudeDir } from './file-system.js';
import {
  FILE_OPERATION_QUEUE_CONCURRENCY,
  WATCHER_STABILITY_THRESHOLD,
  WATCHER_POLL_INTERVAL,
  WATCHER_READY_SETTLING_DELAY,
} from './constants.js';

/**
 * Claude settings structure from ~/.claude/settings.json
 */
export interface ClaudeSettings {
  alwaysThinkingEnabled: boolean;
}

/**
 * Callbacks for settings watcher events
 */
export interface SettingsWatcherCallbacks {
  onChange: (settings: ClaudeSettings) => void;
}

/**
 * Settings file watcher
 *
 * Watches ~/.claude/settings.json for changes and parses the alwaysThinkingEnabled value.
 * Handles missing file gracefully by defaulting to false.
 */
export class SettingsWatcher {
  private watcher: FSWatcher;
  private settingsPath: string;
  private callbacks: SettingsWatcherCallbacks;
  private queue: PQueue;
  private readyPromise: Promise<void>;

  constructor(callbacks: SettingsWatcherCallbacks, claudeDir?: string) {
    const baseDir = claudeDir || getClaudeDir();
    this.settingsPath = path.join(baseDir, 'settings.json');
    this.callbacks = callbacks;

    logger.info('[SettingsWatcher] Creating watcher', {
      settingsPath: this.settingsPath,
    });

    // Create async queue to serialize file operations
    this.queue = new PQueue({ concurrency: FILE_OPERATION_QUEUE_CONCURRENCY });

    // Watch the settings file
    this.watcher = chokidar.watch(this.settingsPath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: WATCHER_STABILITY_THRESHOLD,
        pollInterval: WATCHER_POLL_INTERVAL,
      },
    });

    // Create promise that resolves when watcher is ready
    this.readyPromise = new Promise<void>((resolve) => {
      this.watcher.on('ready', () => {
        logger.debug('[SettingsWatcher] Watcher ready');
        resolve();
      });
    });

    // Handle file changes
    this.watcher.on('change', (changedPath) => {
      logger.debug('[SettingsWatcher] File changed', { changedPath });

      void this.queue.add(async () => {
        try {
          const settings = await this.readSettings();
          this.callbacks.onChange(settings);
        } catch (error) {
          logger.error('Error handling settings file change', {
            filePath: changedPath,
            error,
          });
        }
      });
    });

    // Handle new file creation (if settings.json didn't exist before)
    this.watcher.on('add', (addedPath) => {
      logger.debug('[SettingsWatcher] File created', { addedPath });

      void this.queue.add(async () => {
        try {
          const settings = await this.readSettings();
          this.callbacks.onChange(settings);
        } catch (error) {
          logger.error('Error handling settings file creation', {
            filePath: addedPath,
            error,
          });
        }
      });
    });
  }

  /**
   * Read and parse the settings file
   * Returns default settings if file doesn't exist or can't be parsed
   */
  async readSettings(): Promise<ClaudeSettings> {
    try {
      const content = await fs.readFile(this.settingsPath, 'utf-8');
      const parsed = JSON.parse(content) as Partial<ClaudeSettings>;

      // Extract alwaysThinkingEnabled with default fallback
      const alwaysThinkingEnabled =
        typeof parsed.alwaysThinkingEnabled === 'boolean' ? parsed.alwaysThinkingEnabled : false;

      logger.debug('[SettingsWatcher] Settings read', {
        settingsPath: this.settingsPath,
        alwaysThinkingEnabled,
      });

      return { alwaysThinkingEnabled };
    } catch (error) {
      // File doesn't exist or is invalid JSON - return default settings
      const isNotFound = (error as NodeJS.ErrnoException).code === 'ENOENT';

      if (isNotFound) {
        logger.debug('[SettingsWatcher] Settings file not found, using defaults', {
          settingsPath: this.settingsPath,
        });
      } else {
        logger.warn('[SettingsWatcher] Failed to parse settings file, using defaults', {
          settingsPath: this.settingsPath,
          error,
        });
      }

      return { alwaysThinkingEnabled: false };
    }
  }

  /**
   * Wait for the watcher to be ready
   * Includes a settling delay after the 'ready' event
   */
  async waitForReady(): Promise<void> {
    await this.readyPromise;
    await new Promise((resolve) => setTimeout(resolve, WATCHER_READY_SETTLING_DELAY));
  }

  /**
   * Wait for all pending queue operations to complete
   */
  async waitForIdle(): Promise<void> {
    await this.queue.onIdle();
  }

  /**
   * Clean up watcher
   */
  async close(): Promise<void> {
    logger.info('[SettingsWatcher] Closing');

    try {
      await this.watcher.close();
      logger.debug('[SettingsWatcher] Chokidar watcher closed');
    } catch (error) {
      logger.error('Error closing settings watcher', error);
    }

    try {
      await this.queue.onIdle();
      logger.debug('[SettingsWatcher] Queue drained');
    } catch (error) {
      logger.error('Error waiting for queue to drain', error);
    }

    logger.info('[SettingsWatcher] Closed');
  }
}
