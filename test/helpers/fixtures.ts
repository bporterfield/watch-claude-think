import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURES_DIR = path.join(__dirname, "..", "fixtures", "mock-claude", "projects", "project-alpha");

/**
 * Path to the mock Claude directory for read-only tests
 * Structure: test/fixtures/mock-claude/.claude/projects/...
 */
export const MOCK_CLAUDE_DIR = path.join(__dirname, "..", "fixtures", "mock-claude");

/**
 * Available fixture names (located in project-alpha)
 */
export const FIXTURES = {
  SIMPLE: "simple-session.jsonl",
  COMPACTED: "compacted-session.jsonl",
  SIMPLE_COMPACTED: "simple-compacted.jsonl",
  MULTI_THINKING: "multi-thinking.jsonl",
  SYSTEM_MESSAGES: "system-messages.jsonl",
  EMPTY: "empty-session.jsonl",
  ORPHANED_SUMMARY: "orphaned-summary.jsonl",
} as const;

/**
 * Copy a fixture file to a destination
 */
export async function copyFixture(
  fixtureName: string,
  destPath: string
): Promise<void> {
  const sourcePath = path.join(FIXTURES_DIR, fixtureName);
  await fs.copyFile(sourcePath, destPath);
}

/**
 * Get the content of a fixture file
 */
export async function readFixture(fixtureName: string): Promise<string> {
  const sourcePath = path.join(FIXTURES_DIR, fixtureName);
  return fs.readFile(sourcePath, "utf-8");
}

/**
 * Copy multiple fixtures to a project directory
 */
export async function copyFixturesToProject(
  projectPath: string,
  fixtures: Array<{ name: string; sessionId: string }>
): Promise<void> {
  await Promise.all(
    fixtures.map(({ name, sessionId }) => {
      const destPath = path.join(projectPath, `${sessionId}.jsonl`);
      return copyFixture(name, destPath);
    })
  );
}
