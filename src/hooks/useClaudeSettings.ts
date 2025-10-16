/**
 * useClaudeSettings - Manages Claude settings lifecycle
 *
 * Handles creation, initialization, and cleanup of:
 * - SettingsManager
 *
 * Returns reactive settings state that updates when ~/.claude/settings.json changes
 */

import { useState, useEffect, useRef } from 'react';
import { logger } from '../lib/logger.js';
import { SettingsManager, type SettingsChangeEvent } from '../services/settings-manager.js';
import type { ClaudeSettings } from '../lib/settings-watcher.js';

interface UseClaudeSettingsReturn {
  settings: ClaudeSettings;
  alwaysThinkingEnabled: boolean;
}

export function useClaudeSettings(): UseClaudeSettingsReturn {
  // UI state
  const [settings, setSettings] = useState<ClaudeSettings>({
    alwaysThinkingEnabled: false,
  });

  // Service (created once)
  const settingsManager = useRef<SettingsManager | null>(null);

  // Initialize service
  useEffect(() => {
    logger.info('[useClaudeSettings] Mounting');

    // Create service
    const manager = new SettingsManager();

    // Save ref
    settingsManager.current = manager;

    // Subscribe to changes
    const unsubscribe = manager.onChange((event: SettingsChangeEvent) => {
      setSettings(event.settings);
    });

    // Initialize
    const init = async () => {
      try {
        await manager.initialize();
        logger.info('[useClaudeSettings] Initialized', {
          alwaysThinkingEnabled: manager.getSettings().alwaysThinkingEnabled,
        });
      } catch (error) {
        logger.error('[useClaudeSettings] Failed to initialize', { error });
        // Continue with default settings on error
      }
    };

    init();

    // Cleanup
    return () => {
      const cleanup = async () => {
        unsubscribe();
        await manager.cleanup();
        settingsManager.current = null;
      };
      void cleanup();
    };
  }, []);

  return {
    settings,
    alwaysThinkingEnabled: settings.alwaysThinkingEnabled,
  };
}
