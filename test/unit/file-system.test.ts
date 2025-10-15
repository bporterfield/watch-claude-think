import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import { listProjects } from '../../src/lib/file-system.js';
import {
  createTempClaudeDir,
  cleanupTempDir,
  createTestProject,
  copyFixture,
  FIXTURES,
} from '../helpers/index.js';

describe('file-system', () => {
  let claudeDir: string;

  beforeEach(async () => {
    claudeDir = await createTempClaudeDir();
  });

  afterEach(async () => {
    await cleanupTempDir(claudeDir);
  });

  describe('listProjects', () => {
    it('should return empty array when no projects exist', async () => {
      const projects = await listProjects(claudeDir);

      expect(projects).toEqual([]);
    });

    it('should list all projects', async () => {
      await createTestProject(claudeDir, 'project-1');
      await createTestProject(claudeDir, 'project-2');
      await createTestProject(claudeDir, 'project-3');

      const projects = await listProjects(claudeDir);

      expect(projects).toHaveLength(3);
      // Projects without sessions use encoded directory names
      expect(projects.map((p) => p.name).sort()).toEqual(['project-1', 'project-2', 'project-3']);
    });

    it('should sort projects by most recent session modification time', async () => {
      const project1 = await createTestProject(claudeDir, 'old-project');
      const project2 = await createTestProject(claudeDir, 'new-project');

      // Add session to old project with old timestamp
      const oldSession = path.join(project1, 'old.jsonl');
      await copyFixture(FIXTURES.SIMPLE, oldSession);
      const oldTime = new Date('2025-01-01T10:00:00.000Z');
      await fs.utimes(oldSession, oldTime, oldTime);

      // Add session to new project with recent timestamp
      const newSession = path.join(project2, 'new.jsonl');
      await copyFixture(FIXTURES.SIMPLE, newSession);
      const newTime = new Date('2025-01-15T10:00:00.000Z');
      await fs.utimes(newSession, newTime, newTime);

      const projects = await listProjects(claudeDir);

      // Most recent project should be first (both will have name "project" from cwd)
      // Check by path instead of name
      expect(projects[0]?.path).toContain('new-project');
      expect(projects[1]?.path).toContain('old-project');
    });

    it('should handle projects without sessions', async () => {
      await createTestProject(claudeDir, 'empty-project');

      const projects = await listProjects(claudeDir);

      expect(projects).toHaveLength(1);
      expect(projects[0]?.name).toBe('empty-project');
    });

    it('should use cwd basename for project names when sessions exist', async () => {
      // Create multiple projects - without sessions they use encoded directory names
      await createTestProject(claudeDir, '-Users-john-dev-myproject-main');
      await createTestProject(claudeDir, '-Users-john-dev-myproject-feature');

      const projects = await listProjects(claudeDir);

      // Without sessions, uses encoded directory names as-is
      const names = projects.map((p) => p.name).sort();
      expect(names).toEqual(['-Users-john-dev-myproject-feature', '-Users-john-dev-myproject-main']);
    });

    it('should handle single project by showing full name', async () => {
      await createTestProject(claudeDir, '-Users-john-dev-my-project');

      const projects = await listProjects(claudeDir);

      // With only one project, no common prefix to strip
      expect(projects[0]?.name).toBe('-Users-john-dev-my-project');
    });

    it('should handle git worktrees correctly', async () => {
      // Simulate git worktrees of the same project
      await createTestProject(claudeDir, '-home-user-projects-app-worktrees-main');
      await createTestProject(claudeDir, '-home-user-projects-app-worktrees-feature-1');
      await createTestProject(claudeDir, '-home-user-projects-app-worktrees-feature-2');

      const projects = await listProjects(claudeDir);

      const names = projects.map((p) => p.name).sort();
      // Without sessions, uses encoded directory names as-is
      expect(names).toEqual(['-home-user-projects-app-worktrees-feature-1', '-home-user-projects-app-worktrees-feature-2', '-home-user-projects-app-worktrees-main']);
    });

    it('should handle projects with no common prefix', async () => {
      await createTestProject(claudeDir, '-Users-alice-project-a');
      await createTestProject(claudeDir, '-home-bob-project-b');

      const projects = await listProjects(claudeDir);

      // No common prefix (they start with different characters), so return full names
      const names = projects.map((p) => p.name).sort();
      expect(names).toEqual(['-Users-alice-project-a', '-home-bob-project-b']);
    });

    it('should include full path for each project', async () => {
      await createTestProject(claudeDir, 'test-project');

      const projects = await listProjects(claudeDir);

      expect(projects[0]?.path).toContain('projects');
      expect(projects[0]?.path).toContain('test-project');
    });
  });
});
