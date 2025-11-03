import React from 'react';
import { Box, Text, useInput } from 'ink';
import chalk from 'chalk';
import type { ConversationInfo, ProjectInfo } from '../lib/file-system.js';
import { getProjectColor } from '../lib/colors.js';
import { NonWrappingSelectInput } from './NonWrappingSelectInput.js';
import { useSelectInputLimit } from '../hooks/useSelectInputLimit.js';
import { useClaudeSettings } from '../hooks/useClaudeSettings.js';

interface SessionSelectorProps {
  sessions: ConversationInfo[];
  project: ProjectInfo;
  onSelect: (session: ConversationInfo | 'all' | 'all-worktrees') => void;
  onBack?: () => void;
}

interface SessionItemProps {
  isSelected?: boolean;
  label: string;
}

const SessionItem: React.FC<SessionItemProps> = ({ isSelected = false, label }) => {
  const claudeOrange = chalk.hex('#da7756');

  // Parse the label to extract name and metadata
  const parts = label.split('|||');
  if (parts.length === 1) {
    // "Watch all sessions"
    const displayText = isSelected ? `> ${label}` : `  ${label}`;
    return (
      <Box marginBottom={1}>
        <Text>{claudeOrange(displayText)}</Text>
      </Box>
    );
  }

  const [name, timeAgo, gitBranch] = parts;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text>{isSelected ? `> ${name}` : `  ${name}`}</Text>
      <Text dimColor>
        {'  '}
        {gitBranch ? `${timeAgo} · ${gitBranch}` : timeAgo}
      </Text>
    </Box>
  );
};

export const SessionSelector: React.FC<SessionSelectorProps> = ({
  sessions,
  project,
  onSelect,
  onBack,
}) => {
  const projectColor = getProjectColor(project.name);

  // Calculate dynamic list limit based on terminal height
  // SessionItems take 3 rows each: name (1) + metadata (1) + marginBottom (1)
  const limit = useSelectInputLimit(3);

  // Get Claude settings (alwaysThinkingEnabled available for future use)
  const { alwaysThinkingEnabled: _alwaysThinkingEnabled } = useClaudeSettings();

  useInput((input, key) => {
    if (key.escape && onBack) {
      onBack();
    }
  });

  const formatTimeAgo = React.useCallback((date: Date): string => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
    return date.toLocaleDateString();
  }, []);

  const items = React.useMemo(() => {
    const options: Array<{ label: string; value: string }> = [];

    // Add "Watch all sessions (including worktrees)" option if worktrees exist
    const worktreeCount = project.worktreeInfo?.relatedWorktrees?.length ?? 0;
    if (worktreeCount > 0) {
      const worktreeLabel =
        worktreeCount === 1
          ? 'Watch all sessions (including 1 worktree)'
          : `Watch all sessions (including ${worktreeCount} worktrees)`;
      options.push({
        label: worktreeLabel,
        value: 'all-worktrees' as const,
      });
    }

    // Add "Watch all conversations" option
    options.push({
      label: 'Watch all conversations',
      value: 'all' as const,
    });

    // Add individual sessions
    options.push(
      ...sessions.map((session) => ({
        label: `${session.name}|||${formatTimeAgo(session.mtime)}|||${session.gitBranch || ''}`,
        value: session.id,
      }))
    );

    return options;
  }, [sessions, formatTimeAgo, project.worktreeInfo]);

  const handleSelect = (item: { label: string; value: string }) => {
    if (item.value === 'all') {
      onSelect('all');
    } else if (item.value === 'all-worktrees') {
      onSelect('all-worktrees');
    } else {
      const session = sessions.find((s) => s.id === item.value);
      if (session) {
        onSelect(session);
      }
    }
  };

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>
          Select a conversation for {projectColor(project.name)}
          {onBack && <Text dimColor> (ESC to go back)</Text>}:
        </Text>
      </Box>
      <NonWrappingSelectInput
        items={items}
        onSelect={handleSelect}
        itemComponent={SessionItem}
        limit={limit}
      />
    </Box>
  );
};
