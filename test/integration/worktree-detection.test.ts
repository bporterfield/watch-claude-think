import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import { execSync } from 'child_process';
import { listProjects } from '../../src/lib/file-system.js';
import {
  createTempClaudeDir,
  cleanupTempDir,
  createTestProject,
} from '../helpers/index.js';

describe('Git Worktree Detection', () => {
  let claudeDir: string;
  let tempGitDir: string;

  beforeEach(async () => {
    claudeDir = await createTempClaudeDir();

    // Create a temporary directory for git repos
    tempGitDir = path.join(claudeDir, 'git-repos');
    await fs.mkdir(tempGitDir, { recursive: true });
  });

  afterEach(async () => {
    await cleanupTempDir(claudeDir);
  });

  async function createGitRepoWithWorktree(mainRepoName: string, worktreeName: string) {
    // Create main repo
    const mainRepoPath = path.join(tempGitDir, mainRepoName);
    await fs.mkdir(mainRepoPath, { recursive: true });

    // Initialize git repo
    execSync('git init', { cwd: mainRepoPath });
    execSync('git config user.email "test@example.com"', { cwd: mainRepoPath });
    execSync('git config user.name "Test User"', { cwd: mainRepoPath });

    // Create initial commit
    await fs.writeFile(path.join(mainRepoPath, 'README.md'), '# Test Repo');
    execSync('git add .', { cwd: mainRepoPath });
    execSync('git commit -m "Initial commit"', { cwd: mainRepoPath });

    // Create worktree
    const worktreePath = path.join(tempGitDir, worktreeName);
    execSync(`git worktree add "${worktreePath}" -b feature-branch`, {
      cwd: mainRepoPath,
      stdio: 'pipe',
    });

    return { mainRepoPath, worktreePath };
  }

  async function createClaudeProjectForRepo(projectName: string, repoPath: string) {
    const projectPath = await createTestProject(claudeDir, projectName);

    // Create a session file with cwd field pointing to the repo
    const sessionContent = JSON.stringify({
      type: 'user',
      cwd: repoPath,
      gitBranch: 'main',
      message: { role: 'user', content: 'Test message' },
      timestamp: new Date().toISOString(),
    });

    await fs.writeFile(path.join(projectPath, 'session.jsonl'), sessionContent + '\n');

    return projectPath;
  }

  it('should detect main repo and worktree', async () => {
    // Create git repo with worktree
    const { mainRepoPath, worktreePath } = await createGitRepoWithWorktree(
      'main-repo',
      'worktree-1',
    );

    // Create Claude Code projects
    await createClaudeProjectForRepo('project-main', mainRepoPath);
    await createClaudeProjectForRepo('project-worktree', worktreePath);

    // List projects and check worktree detection
    const projects = await listProjects(claudeDir);

    expect(projects).toHaveLength(2);

    // Find main repo project
    const mainProject = projects.find((p) => p.name.includes('main'));
    expect(mainProject).toBeDefined();
    expect(mainProject?.worktreeInfo).toBeDefined();
    expect(mainProject?.worktreeInfo?.isMainRepo).toBe(true);
    // Default branch can be 'main' or 'master' depending on git version/config
    expect(['main', 'master']).toContain(mainProject?.worktreeInfo?.branch);

    // Find worktree project
    const worktreeProject = projects.find((p) => p.name.includes('worktree'));
    expect(worktreeProject).toBeDefined();
    expect(worktreeProject?.worktreeInfo).toBeDefined();
    expect(worktreeProject?.worktreeInfo?.isWorktree).toBe(true);
    expect(worktreeProject?.worktreeInfo?.branch).toBe('feature-branch');

    // Normalize and resolve paths for comparison
    // - macOS has symlinks like /var -> /private/var
    // - Windows vs Unix use different path separators
    const normalizedMainRepoPath = path.normalize(mainRepoPath);
    const resolvedMainRepoPath = await fs.realpath(normalizedMainRepoPath);

    const worktreeMainPath = worktreeProject?.worktreeInfo?.mainRepoPath;
    const resolvedWorktreeMainPath = worktreeMainPath
      ? await fs.realpath(path.normalize(worktreeMainPath))
      : null;

    expect(resolvedWorktreeMainPath).toBe(resolvedMainRepoPath);
  });

  it('should detect related worktrees', async () => {
    // Create git repo with multiple worktrees
    const { mainRepoPath } = await createGitRepoWithWorktree('multi-repo', 'worktree-a');

    // Create second worktree
    const worktreeBPath = path.join(tempGitDir, 'worktree-b');
    execSync(`git worktree add "${worktreeBPath}" -b feature-b`, {
      cwd: mainRepoPath,
      stdio: 'pipe',
    });

    // Create Claude Code projects
    await createClaudeProjectForRepo('project-main', mainRepoPath);
    await createClaudeProjectForRepo('project-a', path.join(tempGitDir, 'worktree-a'));
    await createClaudeProjectForRepo('project-b', worktreeBPath);

    // List projects
    const projects = await listProjects(claudeDir);

    expect(projects).toHaveLength(3);

    // Check that all projects have worktree info
    const projectsWithWorktreeInfo = projects.filter((p) => p.worktreeInfo);
    expect(projectsWithWorktreeInfo).toHaveLength(3);

    // Check that all have the same set of related worktrees
    const mainProject = projects.find((p) => p.worktreeInfo?.isMainRepo);
    expect(mainProject?.worktreeInfo?.relatedWorktrees).toHaveLength(3);
  });

  it('should handle non-git projects gracefully', async () => {
    // Create a non-git project
    const nonGitPath = path.join(tempGitDir, 'non-git');
    await fs.mkdir(nonGitPath, { recursive: true });
    await createClaudeProjectForRepo('project-non-git', nonGitPath);

    // List projects
    const projects = await listProjects(claudeDir);

    expect(projects).toHaveLength(1);
    expect(projects[0]?.worktreeInfo).toBeUndefined();
  });

  it('should handle projects without session files', async () => {
    // Create project without session files
    await createTestProject(claudeDir, 'empty-project');

    // List projects
    const projects = await listProjects(claudeDir);

    expect(projects).toHaveLength(1);
    expect(projects[0]?.worktreeInfo).toBeUndefined();
  });

  it('should handle invalid cwd paths', async () => {
    const projectPath = await createTestProject(claudeDir, 'invalid-cwd');

    // Create session with non-existent cwd
    const sessionContent = JSON.stringify({
      type: 'user',
      cwd: '/non/existent/path',
      message: { role: 'user', content: 'Test' },
      timestamp: new Date().toISOString(),
    });

    await fs.writeFile(path.join(projectPath, 'session.jsonl'), sessionContent + '\n');

    // List projects
    const projects = await listProjects(claudeDir);

    expect(projects).toHaveLength(1);
    expect(projects[0]?.worktreeInfo).toBeUndefined();
  });

  it('should detect branch for regular git repos (non-worktree)', async () => {
    // Create a regular git repo (not a worktree)
    const regularRepoPath = path.join(tempGitDir, 'regular-repo');
    await fs.mkdir(regularRepoPath, { recursive: true });

    // Initialize git repo
    execSync('git init', { cwd: regularRepoPath });
    execSync('git config user.email "test@example.com"', { cwd: regularRepoPath });
    execSync('git config user.name "Test User"', { cwd: regularRepoPath });

    // Create initial commit
    await fs.writeFile(path.join(regularRepoPath, 'README.md'), '# Regular Repo');
    execSync('git add .', { cwd: regularRepoPath });
    execSync('git commit -m "Initial commit"', { cwd: regularRepoPath });

    // Create a feature branch
    execSync('git checkout -b feature-xyz', { cwd: regularRepoPath, stdio: 'pipe' });

    // Create Claude Code project
    await createClaudeProjectForRepo('project-regular', regularRepoPath);

    // List projects
    const projects = await listProjects(claudeDir);

    expect(projects).toHaveLength(1);

    const project = projects[0];
    expect(project).toBeDefined();
    expect(project?.worktreeInfo).toBeDefined();
    expect(project?.worktreeInfo?.isWorktree).toBe(false);
    expect(project?.worktreeInfo?.isMainRepo).toBe(false);
    expect(project?.worktreeInfo?.branch).toBe('feature-xyz');
    expect(project?.worktreeInfo?.relatedWorktrees).toHaveLength(1); // Only itself
  });
});
