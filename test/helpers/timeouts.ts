/**
 * Environment-aware timeout values for tests
 * Automatically adjusts timeouts for CI environments where file operations are slower
 */

// Detect if running in CI environment
const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';

// Apply multiplier for CI environments
const CI_MULTIPLIER = isCI ? 3 : 1;

/**
 * Timeout values that adapt to the environment
 */
export const TIMEOUTS = {
  // Environment detection
  isCI,

  // File watching timeouts
  fileChange: 3000 * CI_MULTIPLIER,        // 3s in dev, 9s in CI
  newSession: 5000 * CI_MULTIPLIER,        // 5s in dev, 15s in CI

  // General operation timeouts
  shortOperation: 1000 * CI_MULTIPLIER,    // 1s in dev, 3s in CI
  mediumOperation: 3000 * CI_MULTIPLIER,   // 3s in dev, 9s in CI
  longOperation: 5000 * CI_MULTIPLIER,     // 5s in dev, 15s in CI

  // Chokidar watcher settings (more aggressive polling in CI)
  chokidar: {
    stabilityThreshold: isCI ? 500 : 200,  // How long to wait for file to stop changing
    pollInterval: isCI ? 100 : 50,         // How often to poll for changes
  },

  // Retry configuration
  retries: isCI ? 3 : 1,                   // Number of retries for flaky operations
  retryDelay: isCI ? 1000 : 500,           // Delay between retries in ms
};

/**
 * Get a custom timeout with CI multiplier applied
 * @param baseMs Base timeout in milliseconds
 * @returns Adjusted timeout for the current environment
 */
export function getTimeout(baseMs: number): number {
  return baseMs * CI_MULTIPLIER;
}

/**
 * Log timeout-related debugging information in CI
 */
export function logTimeoutDebug(operation: string, elapsed: number, timeout: number): void {
  if (isCI) {
    console.log(`[CI Timeout Debug] ${operation}:`, {
      elapsed: `${elapsed}ms`,
      timeout: `${timeout}ms`,
      remaining: `${timeout - elapsed}ms`,
      platform: process.platform,
      nodeVersion: process.version,
    });
  }
}