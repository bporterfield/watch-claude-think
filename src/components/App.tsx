import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import path from "path";
import {
  listProjects,
  listConversations,
  getAllSessionFilePaths,
  getProjectPathForWorktree,
  type ProjectInfo,
  type ConversationInfo,
} from "../lib/file-system.js";
import { ProjectSelector } from "./ProjectSelector.js";
import { SessionSelector } from "./SessionSelector.js";
import { StreamView } from "./StreamView.js";
import { ErrorBoundary } from "./ErrorBoundary.js";
import { logger } from "../lib/logger.js";

type AppState =
  | { stage: "loading" }
  | { stage: "loading-conversations"; projectName: string }
  | { stage: "select-project"; projects: ProjectInfo[] }
  | {
      stage: "select-conversation";
      project: ProjectInfo;
      conversations: ConversationInfo[];
    }
  | {
      stage: "watching";
      sessionFiles: Array<{ projectName: string; projectPath: string; sessionPath: string; sessionName: string }>;
    }
  | { stage: "error"; message: string };

/**
 * Navigation history frame for back navigation
 * Stores the data needed to restore a previous view
 */
type NavigationFrame =
  | { type: "project-list"; projects: ProjectInfo[] }
  | {
      type: "conversation-list";
      project: ProjectInfo;
      conversations: ConversationInfo[];
    };

export const App: React.FC = () => {
  const [state, setState] = useState<AppState>({ stage: "loading" });
  const [navigationStack, setNavigationStack] = useState<NavigationFrame[]>([]);

  useEffect(() => {
    const initialize = async () => {
      try {
        // Show project selector
        const projects = await listProjects();
        if (projects.length === 0) {
          setState({
            stage: "error",
            message: "No Claude Code projects found",
          });
        } else {
          setState({ stage: "select-project", projects });
        }
      } catch (error) {
        setState({
          stage: "error",
          message: `Failed to initialize: ${error}`,
        });
      }
    };

    initialize();
  }, []);

  const handleProjectSelect = async (project: ProjectInfo) => {
    if (state.stage !== "select-project") return;

    // Save projects for back navigation before changing state
    const projects = state.projects;
    setState({ stage: "loading-conversations", projectName: project.name });

    try {
      let memUsage = process.memoryUsage();
      logger.info('[App] Project selected - loading conversations', {
        projectName: project.name,
        heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
      });

      const conversations = await listConversations(project.path);

      memUsage = process.memoryUsage();
      logger.info('[App] Conversations loaded', {
        conversationCount: conversations.length,
        heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
      });

      if (conversations.length === 0) {
        setState({
          stage: "error",
          message: `No conversations found for project ${project.name}`,
        });
      } else {
        // Push current state to navigation stack for back navigation
        setNavigationStack([
          ...navigationStack,
          { type: "project-list", projects },
        ]);

        // Clear screen AND scrollback buffer before showing conversation selector
        process.stdout.write('\x1b[3J\x1b[H\x1b[2J');
        setState({
          stage: "select-conversation",
          project,
          conversations,
        });
      }
    } catch (error) {
      setState({
        stage: "error",
        message: `Failed to load conversations: ${error}`,
      });
    }
  };

  const handleConversationSelect = async (
    project: ProjectInfo,
    conversation: ConversationInfo | "all" | "all-worktrees",
  ) => {
    if (state.stage !== "select-conversation") return;

    // Push current state to navigation stack for back navigation
    setNavigationStack([
      ...navigationStack,
      {
        type: "conversation-list",
        project: state.project,
        conversations: state.conversations,
      },
    ]);

    // Clear screen AND scrollback buffer before showing stream view
    // \x1b[3J clears scrollback, \x1b[H moves cursor to home, \x1b[2J clears screen
    process.stdout.write('\x1b[3J\x1b[H\x1b[2J');

    if (conversation === "all-worktrees") {
      // Watch all sessions across all worktrees
      const worktrees = project.worktreeInfo?.relatedWorktrees || [];

      logger.info('[App] Collecting session files from all worktrees', {
        mainProject: project.name,
        worktreeCount: worktrees.length,
      });

      // Collect session files from all worktrees
      const allSessionFiles: Array<{
        projectName: string;
        projectPath: string;
        sessionPath: string;
        sessionName: string;
      }> = [];

      // Get sessions from current project
      const currentProjectSessions = await getAllSessionFilePaths(project.path);
      const currentConversations = state.conversations;

      for (const sessionPath of currentProjectSessions) {
        const conv = currentConversations.find((c) => c.sessionPath === sessionPath);
        allSessionFiles.push({
          projectName: project.name,
          projectPath: project.path,
          sessionPath,
          sessionName: conv?.name || 'Session',
        });
      }

      // Get sessions from each worktree
      for (const worktree of worktrees) {
        // Skip if this is the current project (already added above)
        if (project.projectDir && worktree.path === project.projectDir) {
          continue;
        }

        // Map worktree directory to Claude project directory
        const worktreeProjectPath = await getProjectPathForWorktree(worktree.path);
        if (!worktreeProjectPath) {
          logger.debug('[App] No Claude project found for worktree', {
            worktreePath: worktree.path,
            worktreeBranch: worktree.branch,
          });
          continue;
        }

        logger.debug('[App] Found Claude project for worktree', {
          worktreePath: worktree.path,
          worktreeBranch: worktree.branch,
          projectPath: worktreeProjectPath,
        });

        // Get all session files from this worktree's project
        const worktreeSessionPaths = await getAllSessionFilePaths(worktreeProjectPath);

        // Get conversations to find session names
        const worktreeConversations = await listConversations(worktreeProjectPath);

        for (const sessionPath of worktreeSessionPaths) {
          const conv = worktreeConversations.find((c) => c.sessionPath === sessionPath);
          allSessionFiles.push({
            projectName: worktree.branch || path.basename(worktree.path),
            projectPath: worktreeProjectPath,
            sessionPath,
            sessionName: conv?.name || 'Session',
          });
        }
      }

      logger.info('[App] Watching sessions from all worktrees', {
        totalSessions: allSessionFiles.length,
        projectCount: new Set(allSessionFiles.map((s) => s.projectPath)).size,
      });

      setState({
        stage: "watching",
        sessionFiles: allSessionFiles,
      });
    } else if (conversation === "all") {
      // Get ALL session files in the project directory
      // This ensures we watch files even if they temporarily have no valid conversations
      // (e.g., files with only sidechain/warmup messages that later get real messages)
      const allSessionPaths = await getAllSessionFilePaths(project.path);
      setState({
        stage: "watching",
        sessionFiles: allSessionPaths.map((sessionPath) => {
          // Find a conversation for this session to get the name, or use placeholder
          const conv = state.conversations.find((c) => c.sessionPath === sessionPath);
          return {
            projectName: project.name,
            projectPath: project.path,
            sessionPath: sessionPath,
            sessionName: conv?.name || 'Session',
          };
        }),
      });
    } else {
      setState({
        stage: "watching",
        sessionFiles: [
          {
            projectName: project.name,
            projectPath: project.path,
            sessionPath: conversation.sessionPath,
            sessionName: conversation.name,
          },
        ],
      });
    }
  };

  const handleBackToProjectSelect = () => {
    if (state.stage === "select-conversation" && navigationStack.length > 0) {
      const memUsage = process.memoryUsage();
      logger.info('[App] Navigating back to project selector', {
        heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
      });

      // Pop the last frame from the stack
      const previousFrame = navigationStack[navigationStack.length - 1];
      setNavigationStack(navigationStack.slice(0, -1));

      // Restore the project list state
      if (previousFrame && previousFrame.type === "project-list") {
        setState({ stage: "select-project", projects: previousFrame.projects });
      }
    }
  };

  const handleBackToConversationSelect = () => {
    if (state.stage === "watching" && navigationStack.length > 0) {
      const memUsage = process.memoryUsage();
      logger.info('[App] Navigating back to conversation selector', {
        heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
      });

      // Pop the last frame from the stack
      const previousFrame = navigationStack[navigationStack.length - 1];
      setNavigationStack(navigationStack.slice(0, -1));

      // Clear screen AND scrollback buffer before showing conversation selector
      process.stdout.write('\x1b[3J\x1b[H\x1b[2J');

      // Restore the conversation list state
      if (previousFrame && previousFrame.type === "conversation-list") {
        setState({
          stage: "select-conversation",
          project: previousFrame.project,
          conversations: previousFrame.conversations,
        });
      }
    }
  };

  if (state.stage === "loading") {
    return (
      <Box>
        <Text>Loading...</Text>
      </Box>
    );
  }

  if (state.stage === "loading-conversations") {
    return (
      <Box>
        <Text>Loading conversations for {state.projectName}...</Text>
      </Box>
    );
  }

  if (state.stage === "error") {
    return (
      <Box>
        <Text color="red">{state.message}</Text>
      </Box>
    );
  }

  if (state.stage === "select-project") {
    return (
      <ErrorBoundary
        fallback={(error) => (
          <Box flexDirection="column" padding={1}>
            <Text bold color="red">
              Error in Project Selector
            </Text>
            <Text color="red">{error.message}</Text>
            <Text dimColor>Check the logs for more details. Press Ctrl+C to exit.</Text>
          </Box>
        )}
      >
        <ProjectSelector
          projects={state.projects}
          onSelect={handleProjectSelect}
        />
      </ErrorBoundary>
    );
  }

  if (state.stage === "select-conversation") {
    return (
      <ErrorBoundary
        fallback={(error) => (
          <Box flexDirection="column" padding={1}>
            <Text bold color="red">
              Error in Session Selector
            </Text>
            <Text color="red">{error.message}</Text>
            <Text dimColor>Press ESC to go back or Ctrl+C to exit.</Text>
          </Box>
        )}
      >
        <SessionSelector
          sessions={state.conversations}
          project={state.project}
          onSelect={(conversation) => handleConversationSelect(state.project, conversation)}
          onBack={handleBackToProjectSelect}
        />
      </ErrorBoundary>
    );
  }

  if (state.stage === "watching") {
    return (
      <ErrorBoundary
        fallback={(error) => (
          <Box flexDirection="column" padding={1}>
            <Text bold color="red">
              Error in Stream View
            </Text>
            <Text color="red">{error.message}</Text>
            <Text dimColor>Press ESC to go back or Ctrl+C to exit.</Text>
          </Box>
        )}
      >
        <StreamView
          sessionFiles={state.sessionFiles}
          onBack={navigationStack.length > 0 ? handleBackToConversationSelect : undefined}
        />
      </ErrorBoundary>
    );
  }

  return null;
};
