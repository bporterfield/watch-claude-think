import fs from "fs/promises";
import { TIMEOUTS, logTimeoutDebug } from "./timeouts.js";

/**
 * Append content to a file (simulating new messages being added)
 */
export async function appendToFile(
  filePath: string,
  content: string
): Promise<void> {
  await fs.appendFile(filePath, content + "\n");
}

/**
 * Wait for a condition to be true with timeout
 * @param condition Function that returns true when condition is met
 * @param timeoutMs Timeout in milliseconds
 * @param debugName Optional name for debugging output in CI
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs: number = TIMEOUTS.mediumOperation,
  debugName?: string
): Promise<void> {
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      try {
        const result = await condition();
        if (result) {
          clearInterval(interval);
          resolve();
        } else if (Date.now() - startTime > timeoutMs) {
          clearInterval(interval);
          const elapsed = Date.now() - startTime;
          logTimeoutDebug(debugName || "waitFor", elapsed, timeoutMs);
          reject(new Error(`Condition${debugName ? ` "${debugName}"` : ''} not met within ${timeoutMs}ms`));
        }
      } catch (error) {
        clearInterval(interval);
        reject(error);
      }
    }, 100);
  });
}

/**
 * Wait for a condition with automatic retry logic for CI environments
 * @param condition Function that returns true when condition is met
 * @param timeoutMs Timeout for each attempt in milliseconds
 * @param retries Number of retries (automatically increased in CI)
 * @param debugName Optional name for debugging output
 */
export async function waitForWithRetry(
  condition: () => boolean | Promise<boolean>,
  timeoutMs: number = TIMEOUTS.mediumOperation,
  retries?: number,
  debugName?: string
): Promise<void> {
  const maxRetries = retries ?? TIMEOUTS.retries;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (TIMEOUTS.isCI && attempt > 1) {
        console.log(`[CI Retry] Attempt ${attempt}/${maxRetries} for ${debugName || 'condition'}`);
      }

      await waitFor(condition, timeoutMs, debugName);
      return; // Success
    } catch (error) {
      if (attempt === maxRetries) {
        throw error; // Final attempt failed
      }

      // Wait before retrying (longer in CI)
      await new Promise(resolve => setTimeout(resolve, TIMEOUTS.retryDelay));
    }
  }
}
