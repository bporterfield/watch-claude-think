import React from 'react';
import { Box, Text, useInput } from 'ink';
import chalk from 'chalk';
import type { ConversationInfo } from '../lib/file-system.js';
import { getProjectColor } from '../lib/colors.js';
import { NonWrappingSelectInput } from './NonWrappingSelectInput.js';
import { useSelectInputLimit } from '../hooks/useSelectInputLimit.js';
import { useClaudeSettings } from '../hooks/useClaudeSettings.js';

interface SessionSelectorProps {
  sessions: ConversationInfo[];
  projectName: string;
  onSelect: (session: ConversationInfo | 'all') => void;
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
        {' '}
        {gitBranch ? `${timeAgo} · ${gitBranch}` : timeAgo}
      </Text>
    </Box>
  );
};

export const SessionSelector: React.FC<SessionSelectorProps> = ({
  sessions,
  projectName,
  onSelect,
  onBack,
}) => {
  const projectColor = getProjectColor(projectName);

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

  const items = React.useMemo(
    () => [
      {
        label: 'Watch all conversations',
        value: 'all' as const,
      },
      ...sessions.map((session) => ({
        label: `${session.name}|||${formatTimeAgo(session.mtime)}|||${session.gitBranch || ''}`,
        value: session.id,
      })),
    ],
    [sessions, formatTimeAgo],
  );

  const handleSelect = (item: { label: string; value: string }) => {
    if (item.value === 'all') {
      onSelect('all');
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
          Select a conversation for {projectColor(projectName)}
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
