import { logger } from '../lib/logger.js';
import { SettingsWatcher, type ClaudeSettings } from '../lib/settings-watcher.js';

/**
 * Event emitted when settings change
 */
export interface SettingsChangeEvent {
  settings: ClaudeSettings;
}

/**
 * Callback type for settings changes
 */
export type SettingsChangeCallback = (event: SettingsChangeEvent) => void;

/**
 * Service for managing Claude settings
 *
 * Responsibilities:
 * - Watch settings file for changes
 * - Store current settings state
 * - Emit events when settings change
 */
export class SettingsManager {
  private watcher: SettingsWatcher | null = null;
  private currentSettings: ClaudeSettings = { alwaysThinkingEnabled: false };
  private changeListeners = new Set<SettingsChangeCallback>();
  private claudeDir?: string;

  constructor(claudeDir?: string) {
    this.claudeDir = claudeDir;
  }

  /**
   * Initialize the manager - read current settings and start watching
   */
  async initialize(): Promise<void> {
    logger.debug('[SettingsManager] Initializing');

    // Create watcher
    this.watcher = new SettingsWatcher(
      {
        onChange: (settings) => {
          this.handleSettingsChange(settings);
        },
      },
      this.claudeDir,
    );

    // Read initial settings
    const initialSettings = await this.watcher.readSettings();
    this.currentSettings = initialSettings;

    logger.info('[SettingsManager] Initialized', {
      alwaysThinkingEnabled: this.currentSettings.alwaysThinkingEnabled,
    });

    // Notify listeners of initial settings
    this.notifyChange({
      settings: this.currentSettings,
    });
  }

  /**
   * Handle settings change event from watcher
   */
  private handleSettingsChange(settings: ClaudeSettings): void {
    logger.debug('[SettingsManager] Settings changed', {
      oldValue: this.currentSettings.alwaysThinkingEnabled,
      newValue: settings.alwaysThinkingEnabled,
    });

    this.currentSettings = settings;

    this.notifyChange({
      settings: this.currentSettings,
    });
  }

  /**
   * Get current settings
   */
  getSettings(): ClaudeSettings {
    return this.currentSettings;
  }

  /**
   * Subscribe to settings changes
   * Returns unsubscribe function
   */
  onChange(callback: SettingsChangeCallback): () => void {
    this.changeListeners.add(callback);
    return () => {
      this.changeListeners.delete(callback);
    };
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    logger.info('[SettingsManager] Starting cleanup', {
      listenerCount: this.changeListeners.size,
    });

    if (this.watcher) {
      try {
        await this.watcher.close();
        logger.debug('[SettingsManager] Watcher closed');
      } catch (error) {
        logger.error('Error closing settings watcher', error);
      }
      this.watcher = null;
    }

    try {
      this.changeListeners.clear();
      logger.debug('[SettingsManager] Listeners cleared');
    } catch (error) {
      logger.error('Error clearing listeners', error);
    }

    logger.info('[SettingsManager] Cleanup complete');
  }

  /**
   * Notify change listeners
   */
  private notifyChange(event: SettingsChangeEvent): void {
    for (const listener of this.changeListeners) {
      listener(event);
    }
  }
}
