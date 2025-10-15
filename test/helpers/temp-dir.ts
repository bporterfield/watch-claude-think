import fs from "fs/promises";
import path from "path";
import os from "os";

/**
 * Create a temporary .claude/projects directory structure for testing
 * Returns the path to the Claude directory (e.g., /tmp/claude-test-xyz/.claude)
 */
export async function createTempClaudeDir(): Promise<string> {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "claude-test-"));
  const claudeDir = path.join(tempHome, ".claude");
  const projectsDir = path.join(claudeDir, "projects");
  await fs.mkdir(projectsDir, { recursive: true });
  return claudeDir;
}

/**
 * Create a test project directory
 * @param claudeDir Path to the Claude directory (e.g., /tmp/claude-test-xyz/.claude)
 * @param projectName Name of the project
 * @returns Path to the created project directory
 */
export async function createTestProject(
  claudeDir: string,
  projectName: string
): Promise<string> {
  const projectPath = path.join(claudeDir, "projects", projectName);
  await fs.mkdir(projectPath, { recursive: true });
  return projectPath;
}

/**
 * Cleanup temporary directory with retry logic for Windows file locking
 * @param claudeDir Path to the Claude directory to cleanup
 */
export async function cleanupTempDir(claudeDir: string): Promise<void> {
  const tempHome = path.dirname(claudeDir);
  const maxRetries = 3;
  const retryDelay = 200; // ms - increased for Windows chokidar file handle release

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await fs.rm(tempHome, { recursive: true, force: true });
      return; // Success!
    } catch (error) {
      // On Windows, EPERM errors are common when file handles haven't been released yet
      const isEPERM = error instanceof Error && 'code' in error && error.code === 'EPERM';
      const isLastAttempt = attempt === maxRetries - 1;

      if (isEPERM && !isLastAttempt) {
        // Wait before retrying (give Windows time to release file handles)
        // Delays: 200ms, 400ms, 600ms
        await new Promise((resolve) => setTimeout(resolve, retryDelay * (attempt + 1)));
        continue;
      }

      // Last attempt or non-EPERM error - just warn and continue
      console.warn(`Failed to cleanup temp dir after ${attempt + 1} attempts: ${claudeDir}`, error);
      break;
    }
  }
}
