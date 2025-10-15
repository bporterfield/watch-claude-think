import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as readline from 'readline';
import { logger } from './logger.js';
import type { JSONLEntry } from '../types/claude-message.js';

const execAsync = promisify(exec);

export interface WorktreeInfo {
  isWorktree: boolean;
  isMainRepo: boolean;
  branch: string | null;
  mainRepoPath: string | null;
  relatedWorktrees: Array<{
    path: string;
    branch: string;
    isMain: boolean;
  }>;
}

export interface ProjectInfo {
  name: string;
  path: string;
  projectDir: string | null;
  worktreeInfo?: WorktreeInfo;
}

export interface ConversationInfo {
  id: string; // Unique identifier: `${sessionId}-${leafUuid}`
  name: string; // Summary or fallback to first user message
  sessionPath: string; // Path to the .jsonl file containing this conversation
  sessionId: string; // Session file id (filename without .jsonl)
  leafUuid: string; // The leaf UUID for this conversation branch
  mtime: Date; // Timestamp of last message in this conversation (the leaf)
}

/**
 * Get the base Claude directory
 * Can be overridden with CLAUDE_DIR environment variable
 * @returns Path to Claude directory (e.g., ~/.claude)
 */
export function getClaudeDir(): string {
  return process.env.CLAUDE_DIR || path.join(os.homedir(), '.claude');
}

/**
 * Get the Claude projects directory
 * @param claudeDir Optional path to Claude base directory (defaults to ~/.claude or CLAUDE_DIR env var)
 * @returns Path to projects directory (e.g., ~/.claude/projects)
 */
export function getClaudeProjectsDir(claudeDir?: string): string {
  const baseDir = claudeDir || getClaudeDir();
  return path.join(baseDir, 'projects');
}


/**
 * Extract the working directory (cwd) from a Claude Code project
 * Returns the initial cwd where Claude was launched, extracted from recent session files
 *
 * IMPORTANT: We do NOT try to decode the Claude project directory name to get the path.
 * Claude Code encodes paths in project names (e.g., /Users/john/project -> -Users-john-project),
 * and we have no way to know if "-" is in the directory name or was a slash.
 * Instead, we read the cwd field directly from session files, which is reliable.
 *
 * Research findings (see research/sessions/CWD_BEHAVIOR.md):
 * - The initial cwd (first message with cwd field) reflects where Claude was launched
 * - cwd can become unreliable DURING a session after cd commands (some update it, some don't)
 * - For initial cwd, any message type (user, assistant, system) is equally reliable
 *
 * @param projectPath Path to Claude Code project directory (e.g., ~/.claude/projects/project-name)
 * @returns The initial working directory path, or null if not found
 */
async function extractCwdFromProject(projectPath: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(projectPath, { withFileTypes: true });
    const sessionFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'));

    if (sessionFiles.length === 0) {
      return null;
    }

    // Sort by mtime (most recent first) and check up to 10 sessions to find valid cwds
    const sessionFilesWithStats = await Promise.all(
      sessionFiles.map(async (entry) => {
        const filePath = path.join(projectPath, entry.name);
        const stats = await fs.stat(filePath);
        return { entry, mtime: stats.mtime };
      }),
    );

    sessionFilesWithStats.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
    const recentSessions = sessionFilesWithStats.slice(0, 10);

    // Extract initial cwd from each recent session
    const cwds: string[] = [];

    for (const { entry } of recentSessions) {
      const sessionPath = path.join(projectPath, entry.name);
      const fileStream = await fs.open(sessionPath, 'r');
      const rl = readline.createInterface({
        input: fileStream.createReadStream(),
        crlfDelay: Infinity,
      });

      try {
        // Read first 20 lines looking for any message with a cwd field
        let lineCount = 0;
        for await (const line of rl) {
          if (lineCount++ >= 20) break; // Don't read entire file

          try {
            const entry = JSON.parse(line) as JSONLEntry;

            // Accept cwd from any message type - at session start they all have the initial cwd
            // Both ClaudeMessageEntry and SystemEntry have cwd fields
            if ('cwd' in entry && entry.cwd) {
              cwds.push(entry.cwd);
              break; // Found cwd for this session
            }
          } catch {
            // Skip invalid JSON lines
            continue;
          }
        }
      } finally {
        rl.close();
        await fileStream.close();
      }

      // If we've found cwds from 2 sessions, that's enough to verify consistency
      if (cwds.length >= 2) {
        break;
      }
    }

    // Return the first cwd found (from most recent session)
    const firstCwd = cwds[0];
    if (!firstCwd) {
      return null;
    }

    // If we collected multiple, log a warning if they don't match
    if (cwds.length > 1 && cwds.some((cwd) => cwd !== firstCwd)) {
      logger.debug('CWD mismatch across recent sessions', {
        projectPath,
        cwds,
        usingFirst: firstCwd,
      });
    }

    return firstCwd;
  } catch (error) {
    logger.debug('Failed to extract cwd from project', { projectPath, error });
    return null;
  }
}

/**
 * Detect if a directory is a git worktree and get related information
 * @param cwd Working directory to check
 * @returns WorktreeInfo or null if not a git repository
 */
async function getWorktreeInfo(cwd: string): Promise<WorktreeInfo | null> {
  try {
    // Check if directory exists
    const cwdStat = await fs.stat(cwd).catch(() => null);
    if (!cwdStat?.isDirectory()) {
      return null;
    }

    const gitPath = path.join(cwd, '.git');
    const gitStat = await fs.stat(gitPath).catch(() => null);

    if (!gitStat) {
      // No .git, not a git repo
      return null;
    }

    // Check if .git is a file (worktree) or directory (main/regular repo)
    const isWorktree = gitStat.isFile();
    let mainRepoPath: string | null = null;
    let branch: string | null = null;

    if (isWorktree) {
      // Parse .git file to find main repo
      // Git uses forward slashes even on Windows in the gitdir path
      const gitFileContent = await fs.readFile(gitPath, 'utf-8');
      const match = gitFileContent.match(/^gitdir:\s*(.+)$/m);
      if (match && match[1]) {
        // gitdir points to: /path/to/main/.git/worktrees/worktree-name (Unix)
        // or: C:/path/to/main/.git/worktrees/worktree-name (Windows with forward slashes)
        // or: C:\path\to\main\.git\worktrees\worktree-name (Windows with backslashes)
        const gitdir = match[1].trim();

        // Normalize to use OS-appropriate separators
        const normalizedGitdir = path.normalize(gitdir);

        // Parse by splitting and reconstructing - simple and OS-independent
        const parts = normalizedGitdir.split(path.sep);
        // Find the .git directory and go up one level
        const gitIndex = parts.findIndex((p) => p === '.git');
        if (gitIndex > 0) {
          mainRepoPath = parts.slice(0, gitIndex).join(path.sep);
        }
      }
    }

    // Get current branch
    try {
      const { stdout: branchOutput } = await execAsync('git rev-parse --abbrev-ref HEAD', {
        cwd,
      });
      branch = branchOutput.trim();
    } catch {
      branch = null;
    }

    // Get all related worktrees (works from both main repo and worktrees)
    const relatedWorktrees: Array<{ path: string; branch: string; isMain: boolean }> = [];

    try {
      const { stdout: worktreeList } = await execAsync('git worktree list --porcelain', {
        cwd,
      });

      // Parse porcelain output - handle both Unix (\n) and Windows (\r\n) line endings
      const lines = worktreeList.split(/\r?\n/);
      let currentWorktree: { path: string; branch: string; isMain: boolean } | null = null;

      for (const line of lines) {
        const trimmedLine = line.trim();

        if (trimmedLine.startsWith('worktree ')) {
          if (currentWorktree) {
            relatedWorktrees.push(currentWorktree);
          }
          // Normalize the path to use OS-appropriate separators
          const worktreePath = trimmedLine.slice('worktree '.length);
          currentWorktree = {
            path: path.normalize(worktreePath),
            branch: '',
            isMain: false,
          };
        } else if (trimmedLine.startsWith('branch ') && currentWorktree) {
          currentWorktree.branch = trimmedLine
            .slice('branch '.length)
            .replace(/^refs\/heads\//, '');
        } else if (trimmedLine.startsWith('bare') && currentWorktree) {
          currentWorktree.isMain = true;
        } else if (trimmedLine === '' && currentWorktree) {
          relatedWorktrees.push(currentWorktree);
          currentWorktree = null;
        }
      }

      if (currentWorktree) {
        relatedWorktrees.push(currentWorktree);
      }

      // First worktree in the list is typically the main repo
      if (relatedWorktrees.length > 0 && relatedWorktrees[0]) {
        relatedWorktrees[0].isMain = true;
      }
    } catch (error) {
      logger.debug('Failed to get worktree list', { cwd, error });
    }

    const isMainRepo = !isWorktree && relatedWorktrees.length > 1;

    return {
      isWorktree,
      isMainRepo,
      branch,
      mainRepoPath,
      relatedWorktrees,
    };
  } catch (error) {
    logger.debug('Failed to get worktree info', { cwd, error });
    return null;
  }
}

/**
 * Get list of all Claude Code projects, sorted by most recent session
 * @param claudeDir Optional path to Claude base directory (defaults to ~/.claude or CLAUDE_DIR env var)
 */
export async function listProjects(claudeDir?: string): Promise<ProjectInfo[]> {
  const claudeProjectsDir = getClaudeProjectsDir(claudeDir);
  try {
    const entries = await fs.readdir(claudeProjectsDir, {
      withFileTypes: true,
    });

    // Get all project directories
    const projectDirs = entries.filter((entry) => entry.isDirectory());

    // OPTIMIZATION: Get cwd, most recent session time, and worktree info in parallel
    const projectsWithInfo = await Promise.all(
      projectDirs.map(async (entry) => {
        const projectPath = path.join(claudeProjectsDir, entry.name);

        try {
          // Extract cwd to determine project name
          const cwd = await extractCwdFromProject(projectPath);
          const projectName = cwd ? path.basename(cwd) : entry.name;

          const sessionFiles = await fs.readdir(projectPath, {
            withFileTypes: true,
          });

          // Find the most recent .jsonl file
          let mostRecentTime: Date | null = null;
          for (const file of sessionFiles) {
            if (file.isFile() && file.name.endsWith('.jsonl')) {
              const filePath = path.join(projectPath, file.name);
              const stats = await fs.stat(filePath);
              if (mostRecentTime === null || stats.mtime.getTime() > mostRecentTime.getTime()) {
                mostRecentTime = stats.mtime;
              }
            }
          }

          // Get worktree info if cwd is available
          const worktreeInfo = cwd ? await getWorktreeInfo(cwd) : null;

          return {
            name: projectName,
            path: projectPath,
            projectDir: cwd,
            mostRecentTime,
            worktreeInfo: worktreeInfo || undefined,
          };
        } catch (error) {
          // If we can't read the directory, treat it as having no sessions
          logger.warn('Failed to read project directory for session times', {
            projectPath,
            error,
          });
          return {
            name: entry.name,
            path: projectPath,
            projectDir: null,
            mostRecentTime: null,
            worktreeInfo: undefined,
          };
        }
      }),
    );

    // Sort by most recent session time (most recent first)
    // Projects without sessions go to the end
    projectsWithInfo.sort((a, b) => {
      if (a.mostRecentTime === null && b.mostRecentTime === null) return 0;
      if (a.mostRecentTime === null) return 1;
      if (b.mostRecentTime === null) return -1;
      return b.mostRecentTime.getTime() - a.mostRecentTime.getTime();
    });

    // Return projects without the temporary mostRecentTime field
    return projectsWithInfo.map(({ name, path, worktreeInfo, projectDir }) => ({
      name,
      path,
      projectDir,
      worktreeInfo,
    }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Get list of conversations for a project, sorted by most recent
 * Returns one entry per conversation branch (leaf message)
 * A single session file can contain multiple conversation branches
 */
export async function listConversations(projectPath: string): Promise<ConversationInfo[]> {
  try {
    const entries = await fs.readdir(projectPath, { withFileTypes: true });
    const sessionFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'));

    if (sessionFiles.length === 0) {
      return [];
    }

    // Import function from parser
    const { extractSummariesAndConversations } = await import('./parser.js');

    // SINGLE PASS: Extract both summaries AND conversations from all files
    // This is much faster than reading each file twice
    logger.debug('[listConversations] Extracting summaries and conversations', {
      projectPath,
      fileCount: sessionFiles.length,
    });

    const fileResults = await Promise.all(
      sessionFiles.map(async (entry) => {
        const filePath = path.join(projectPath, entry.name);
        const sessionId = entry.name.replace('.jsonl', '');

        try {
          const result = await extractSummariesAndConversations(filePath);
          return {
            sessionId,
            filePath,
            summaries: result.summaries,
            conversations: result.conversations,
          };
        } catch (error) {
          logger.debug('Failed to extract data from session file', {
            filePath,
            error,
          });
          return {
            sessionId,
            filePath,
            summaries: [],
            conversations: [],
          };
        }
      }),
    );

    // Build global summary map from all files
    // This is critical because summaries can be in different files than the conversations they describe
    // (resumed sessions have summaries pointing to previous session's leafUuids)
    const globalSummaryMap = new Map<string, string>();
    for (const result of fileResults) {
      for (const { leafUuid, summary } of result.summaries) {
        globalSummaryMap.set(leafUuid, summary);
      }
    }

    logger.debug('[listConversations] Global summary map built', {
      summaryCount: globalSummaryMap.size,
    });

    // Apply cross-file summaries to conversations and map to ConversationInfo
    const allConversations: ConversationInfo[] = [];

    for (const result of fileResults) {
      for (const branch of result.conversations) {
        // Use cross-file summary if this conversation doesn't have one
        const finalSummary = branch.summary || globalSummaryMap.get(branch.leafUuid) || null;

        // Skip conversations with no real user interaction:
        // - No summary AND no non-sidechain user messages (fallbackName is null)
        // These are typically warmup sessions, canceled sessions, or internal operations
        if (!finalSummary && !branch.fallbackName) {
          logger.debug('[listConversations] Skipping conversation with no user interaction', {
            sessionId: result.sessionId,
            leafUuid: branch.leafUuid,
          });
          continue;
        }

        allConversations.push({
          id: `${result.sessionId}-${branch.leafUuid}`,
          name: finalSummary || branch.fallbackName || 'Unnamed conversation',
          sessionPath: result.filePath,
          sessionId: result.sessionId,
          leafUuid: branch.leafUuid,
          mtime: new Date(branch.timestamp),
        });
      }
    }

    // Sort by most recent first
    allConversations.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    logger.debug('[listConversations] Loaded conversations', {
      projectPath,
      sessionFileCount: sessionFiles.length,
      conversationCount: allConversations.length,
    });

    return allConversations;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}
