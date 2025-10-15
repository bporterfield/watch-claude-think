import React from 'react';
import { Box, Text } from 'ink';
import path from 'path';
import type { ProjectInfo } from '../lib/file-system.js';
import { assignProjectColors } from '../lib/colors.js';
import type { ChalkInstance } from 'chalk';
import { NonWrappingSelectInput } from './NonWrappingSelectInput.js';
import chalk from 'chalk';
import { useSelectInputLimit } from '../hooks/useSelectInputLimit.js';

interface ProjectSelectorProps {
  projects: ProjectInfo[];
  onSelect: (project: ProjectInfo) => void;
}

interface ItemProps {
  isSelected?: boolean;
  label: string;
  colorMap: Map<string, ChalkInstance>;
  projectInfo?: ProjectInfo;
}

const ProjectItem: React.FC<ItemProps> = ({ isSelected = false, label, colorMap, projectInfo }) => {
  const projectColor = colorMap.get(label);
  let displayText = projectColor ? projectColor(label) : label;

  // Add worktree indicators and visual hierarchy
  if (projectInfo?.worktreeInfo) {
    const { isWorktree, isMainRepo, branch, relatedWorktrees } = projectInfo.worktreeInfo;

    // Orphaned worktree: has worktree info but no related worktrees
    const isOrphaned = isWorktree && relatedWorktrees.length === 0;

    if (isWorktree && !isOrphaned) {
      // Indent non-orphaned worktrees to show hierarchy
      displayText = chalk.dim('  ├─ ') + displayText;
      if (isSelected && branch) {
        displayText = displayText + chalk.dim(` [${branch}]`);
      }
    } else if (isMainRepo) {
      if (isSelected) {
        displayText = displayText + chalk.dim(' [main]');
      }
    } else if (branch) {
      // Regular git repo or orphaned worktree - show branch only when selected
      if (isSelected) {
        displayText = displayText + chalk.dim(` [${branch}]`);
      }
    }
  }

  const prefix = isSelected ? '> ' : '  ';

  if (isSelected && projectInfo?.projectDir) {
    return (
      <Text>
        {prefix}
        {displayText}
        <Text dimColor> {projectInfo.projectDir}</Text>
      </Text>
    );
  }

  return (
    <Text>
      {prefix}
      {displayText}
    </Text>
  );
};

export const ProjectSelector: React.FC<ProjectSelectorProps> = ({ projects, onSelect }) => {
  // Calculate dynamic list limit based on terminal height
  const limit = useSelectInputLimit();

  // Sort projects to group worktrees with their main repos
  const sortedProjects = React.useMemo(() => {
    // Build a map of git repo paths to their worktree projects
    // We need to get the actual git repo path from relatedWorktrees info
    const repoPathToProjects = new Map<
      string,
      { main: ProjectInfo | null; worktrees: ProjectInfo[] }
    >();
    const standaloneProjects: ProjectInfo[] = [];

    // First pass: identify all projects and their git repo paths
    for (const project of projects) {
      const worktreeInfo = project.worktreeInfo;

      if (!worktreeInfo) {
        standaloneProjects.push(project);
        continue;
      }

      // Get the git repo path - for worktrees it's in mainRepoPath, for main repos we need to get it from relatedWorktrees
      let repoPath: string | null = null;

      if (worktreeInfo.isMainRepo && worktreeInfo.relatedWorktrees.length > 0) {
        // Main repo - use the first worktree's path (which is the main repo itself)
        repoPath = worktreeInfo.relatedWorktrees[0]?.path || null;
      } else if (worktreeInfo.isWorktree && worktreeInfo.mainRepoPath) {
        // Worktree - use the mainRepoPath
        repoPath = worktreeInfo.mainRepoPath;
      }

      // Orphaned worktree: has worktree info but no valid repo relationship
      // Treat as standalone (main repo might have been deleted/recreated)
      if (!repoPath || (worktreeInfo.isWorktree && worktreeInfo.relatedWorktrees.length === 0)) {
        standaloneProjects.push(project);
        continue;
      }

      // Normalize the repo path for consistent matching
      const normalizedRepoPath = path.normalize(repoPath);

      // Initialize group if needed
      if (!repoPathToProjects.has(normalizedRepoPath)) {
        repoPathToProjects.set(normalizedRepoPath, { main: null, worktrees: [] });
      }

      const group = repoPathToProjects.get(normalizedRepoPath)!;

      if (worktreeInfo.isMainRepo) {
        group.main = project;
      } else if (worktreeInfo.isWorktree) {
        group.worktrees.push(project);
      }
    }

    // Create index map from original projects array (already sorted by recency)
    const projectIndex = new Map<string, number>();
    projects.forEach((p, i) => projectIndex.set(p.path, i));

    // Build sorted list: for each repo group, show main followed by worktrees
    // Sort groups by most recent activity (earliest index in original array)
    const sortedGroups = Array.from(repoPathToProjects.entries())
      .map(([repoPath, group]) => {
        // Find earliest index (most recent) in this group
        const allProjectsInGroup = [group.main, ...group.worktrees].filter(
          Boolean,
        ) as ProjectInfo[];
        const earliestIndex = Math.min(
          ...allProjectsInGroup.map((p) => projectIndex.get(p.path) ?? Infinity),
        );
        return { repoPath, group, earliestIndex };
      })
      .sort((a, b) => a.earliestIndex - b.earliestIndex);

    const sorted: ProjectInfo[] = [];

    for (const { group } of sortedGroups) {
      if (group.main) {
        sorted.push(group.main);
      }
      sorted.push(...group.worktrees);
    }

    // Add standalone projects at the end
    sorted.push(...standaloneProjects);

    return sorted;
  }, [projects]);

  // Assign colors to maximize contrast between adjacent projects
  // This also stores assignments in the global registry for Footer to use
  const colorMap = React.useMemo(() => assignProjectColors(sortedProjects), [sortedProjects]);

  // Create a map of project path to project info for easy lookup
  const projectMap = React.useMemo(() => {
    const map = new Map<string, ProjectInfo>();
    sortedProjects.forEach((p) => map.set(p.path, p));
    return map;
  }, [sortedProjects]);

  const items = React.useMemo(
    () =>
      sortedProjects.map((project) => ({
        label: project.name,
        value: project.path,
      })),
    [sortedProjects],
  );

  const handleSelect = (item: { label: string; value: string }) => {
    const project = sortedProjects.find((p) => p.path === item.value);
    if (project) {
      onSelect(project);
    }
  };

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Select a project:</Text>
      </Box>
      <NonWrappingSelectInput
        items={items}
        onSelect={handleSelect}
        itemComponent={(props) => (
          <ProjectItem {...props} colorMap={colorMap} projectInfo={projectMap.get(props.value)} />
        )}
        limit={limit}
      />
      <Box marginTop={1}>
        <Text dimColor>Ctrl+C to exit</Text>
      </Box>
    </Box>
  );
};
