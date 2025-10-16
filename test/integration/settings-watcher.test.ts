import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import { SettingsWatcher, type ClaudeSettings } from '../../src/lib/settings-watcher.js';
import { SettingsManager } from '../../src/services/settings-manager.js';
import {
  createTempClaudeDir,
  cleanupTempDir,
  waitFor,
  TIMEOUTS,
} from '../helpers/index.js';

describe('Settings Watcher Integration', () => {
  let claudeDir: string;
  let settingsPath: string;

  beforeEach(async () => {
    claudeDir = await createTempClaudeDir();
    settingsPath = path.join(claudeDir, 'settings.json');
  });

  afterEach(async () => {
    // On Windows, chokidar's close() may not immediately stop all polling
    // Give it time to fully shut down before deleting files to avoid EPERM errors
    if (process.platform === 'win32') {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    await cleanupTempDir(claudeDir);
  });

  describe('SettingsWatcher', () => {
    it('should read default settings when file does not exist', async () => {
      const watcher = new SettingsWatcher({
        onChange: () => {
          // No-op
        },
      }, claudeDir);

      const settings = await watcher.readSettings();

      expect(settings).toEqual({
        alwaysThinkingEnabled: false,
      });

      await watcher.close();
    });

    it('should read alwaysThinkingEnabled from existing file', async () => {
      // Create settings file
      await fs.writeFile(settingsPath, JSON.stringify({ alwaysThinkingEnabled: true }));

      const watcher = new SettingsWatcher({
        onChange: () => {
          // No-op
        },
      }, claudeDir);

      const settings = await watcher.readSettings();

      expect(settings).toEqual({
        alwaysThinkingEnabled: true,
      });

      await watcher.close();
    });

    it('should detect when settings file is changed', async () => {
      // Create initial settings file
      await fs.writeFile(settingsPath, JSON.stringify({ alwaysThinkingEnabled: false }));

      let changeDetected = false;
      let newSettings: ClaudeSettings | null = null;

      const watcher = new SettingsWatcher({
        onChange: (settings) => {
          changeDetected = true;
          newSettings = settings;
        },
      }, claudeDir);

      await watcher.waitForReady();

      // Modify settings file
      await fs.writeFile(settingsPath, JSON.stringify({ alwaysThinkingEnabled: true }));

      // Wait for change detection
      await waitFor(() => changeDetected, TIMEOUTS.fileChange, 'settings file change');

      expect(changeDetected).toBe(true);
      expect(newSettings).toEqual({
        alwaysThinkingEnabled: true,
      });

      await watcher.close();
    });

    it('should detect when settings file is created', async () => {
      let changeDetected = false;
      let newSettings: ClaudeSettings | null = null;

      const watcher = new SettingsWatcher({
        onChange: (settings) => {
          changeDetected = true;
          newSettings = settings;
        },
      }, claudeDir);

      await watcher.waitForReady();

      // Create settings file
      await fs.writeFile(settingsPath, JSON.stringify({ alwaysThinkingEnabled: true }));

      // Wait for change detection
      await waitFor(() => changeDetected, TIMEOUTS.fileChange, 'settings file creation');

      expect(changeDetected).toBe(true);
      expect(newSettings).toEqual({
        alwaysThinkingEnabled: true,
      });

      await watcher.close();
    });

    it('should handle invalid JSON gracefully', async () => {
      // Create invalid JSON file
      await fs.writeFile(settingsPath, '{ invalid json }');

      const watcher = new SettingsWatcher({
        onChange: () => {
          // No-op
        },
      }, claudeDir);

      const settings = await watcher.readSettings();

      // Should return defaults on parse error
      expect(settings).toEqual({
        alwaysThinkingEnabled: false,
      });

      await watcher.close();
    });

    it('should handle missing alwaysThinkingEnabled field', async () => {
      // Create settings file with other fields
      await fs.writeFile(settingsPath, JSON.stringify({ otherSetting: 'value' }));

      const watcher = new SettingsWatcher({
        onChange: () => {
          // No-op
        },
      }, claudeDir);

      const settings = await watcher.readSettings();

      // Should default to false when field is missing
      expect(settings).toEqual({
        alwaysThinkingEnabled: false,
      });

      await watcher.close();
    });

    it('should handle non-boolean alwaysThinkingEnabled field', async () => {
      // Create settings file with invalid type for alwaysThinkingEnabled
      await fs.writeFile(settingsPath, JSON.stringify({ alwaysThinkingEnabled: 'yes' }));

      const watcher = new SettingsWatcher({
        onChange: () => {
          // No-op
        },
      }, claudeDir);

      const settings = await watcher.readSettings();

      // Should default to false when field has wrong type
      expect(settings).toEqual({
        alwaysThinkingEnabled: false,
      });

      await watcher.close();
    });

    it('should handle rapid successive file modifications', async () => {
      // Create initial settings file
      await fs.writeFile(settingsPath, JSON.stringify({ alwaysThinkingEnabled: false }));

      let changeCount = 0;
      let lastSettings: ClaudeSettings | null = null;

      const watcher = new SettingsWatcher({
        onChange: (settings) => {
          changeCount++;
          lastSettings = settings;
        },
      }, claudeDir);

      await watcher.waitForReady();

      // Rapidly modify the file
      await fs.writeFile(settingsPath, JSON.stringify({ alwaysThinkingEnabled: true }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      await fs.writeFile(settingsPath, JSON.stringify({ alwaysThinkingEnabled: false }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      await fs.writeFile(settingsPath, JSON.stringify({ alwaysThinkingEnabled: true }));

      // Wait for at least some changes to be detected
      await waitFor(() => changeCount > 0, TIMEOUTS.fileChange, 'rapid settings changes');

      expect(changeCount).toBeGreaterThan(0);
      expect(lastSettings).not.toBeNull();

      await watcher.close();
    });
  });

  describe('SettingsManager', () => {
    it('should initialize with default settings when file does not exist', async () => {
      const manager = new SettingsManager(claudeDir);

      await manager.initialize();

      const settings = manager.getSettings();
      expect(settings).toEqual({
        alwaysThinkingEnabled: false,
      });

      await manager.cleanup();
    });

    it('should initialize with settings from file', async () => {
      // Create settings file
      await fs.writeFile(settingsPath, JSON.stringify({ alwaysThinkingEnabled: true }));

      const manager = new SettingsManager(claudeDir);

      await manager.initialize();

      const settings = manager.getSettings();
      expect(settings).toEqual({
        alwaysThinkingEnabled: true,
      });

      await manager.cleanup();
    });

    it('should notify listeners on initialization', async () => {
      // Create settings file
      await fs.writeFile(settingsPath, JSON.stringify({ alwaysThinkingEnabled: true }));

      const manager = new SettingsManager(claudeDir);

      let notificationReceived = false;
      let receivedSettings: ClaudeSettings | null = null;

      manager.onChange((event) => {
        notificationReceived = true;
        receivedSettings = event.settings;
      });

      await manager.initialize();

      expect(notificationReceived).toBe(true);
      expect(receivedSettings).toEqual({
        alwaysThinkingEnabled: true,
      });

      await manager.cleanup();
    });

    it('should notify listeners when settings change', async () => {
      // Create initial settings file
      await fs.writeFile(settingsPath, JSON.stringify({ alwaysThinkingEnabled: false }));

      const manager = new SettingsManager(claudeDir);

      await manager.initialize();

      let changeNotificationReceived = false;
      let newSettings: ClaudeSettings | null = null;

      manager.onChange((event) => {
        changeNotificationReceived = true;
        newSettings = event.settings;
      });

      // Change settings file
      await fs.writeFile(settingsPath, JSON.stringify({ alwaysThinkingEnabled: true }));

      // Wait for change detection
      await waitFor(
        () => changeNotificationReceived,
        TIMEOUTS.fileChange,
        'settings change notification',
      );

      expect(changeNotificationReceived).toBe(true);
      expect(newSettings).toEqual({
        alwaysThinkingEnabled: true,
      });

      await manager.cleanup();
    });

    it('should support unsubscribing from changes', async () => {
      const manager = new SettingsManager(claudeDir);

      await manager.initialize();

      let callCount = 0;
      const unsubscribe = manager.onChange(() => {
        callCount++;
      });

      // Create settings file (should trigger callback)
      await fs.writeFile(settingsPath, JSON.stringify({ alwaysThinkingEnabled: true }));

      await waitFor(() => callCount > 0, TIMEOUTS.fileChange, 'initial change notification');

      const initialCallCount = callCount;

      // Unsubscribe
      unsubscribe();

      // Change settings again (should NOT trigger callback)
      await fs.writeFile(settingsPath, JSON.stringify({ alwaysThinkingEnabled: false }));

      // Wait a bit to ensure no callback is triggered
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Call count should remain the same
      expect(callCount).toBe(initialCallCount);

      await manager.cleanup();
    });

    it('should support multiple listeners', async () => {
      const manager = new SettingsManager(claudeDir);

      await manager.initialize();

      let listener1Called = false;
      let listener2Called = false;

      manager.onChange(() => {
        listener1Called = true;
      });

      manager.onChange(() => {
        listener2Called = true;
      });

      // Change settings file
      await fs.writeFile(settingsPath, JSON.stringify({ alwaysThinkingEnabled: true }));

      // Wait for both listeners to be called
      await waitFor(
        () => listener1Called && listener2Called,
        TIMEOUTS.fileChange,
        'multiple listeners notified',
      );

      expect(listener1Called).toBe(true);
      expect(listener2Called).toBe(true);

      await manager.cleanup();
    });
  });
});
