import React from 'react';
import { Box, Text, type BoxProps } from 'ink';

interface DividerProps {
  /**
   * Character to use for the divider line.
   * @default '─'
   */
  char?: string;

  /**
   * Color of the divider.
   */
  color?: string;

  /**
   * Whether to dim the divider color.
   * @default true
   */
  dimColor?: boolean;

  /**
   * Orientation of the divider.
   * @default 'horizontal'
   */
  orientation?: 'horizontal' | 'vertical';

  /**
   * Additional Box props to pass through.
   */
  boxProps?: BoxProps;
}

/**
 * A divider component that uses Ink's Box border system.
 *
 * CRITICAL: This uses Box borders instead of text repetition to avoid
 * "ghost lines" on terminal resize. When terminal shrinks, text-based
 * dividers (like '─'.repeat(width)) wrap and leave duplicate lines.
 * Box borders are atomic rendering operations that resize cleanly.
 *
 * Based on Claude Code's implementation (lines 279591-279644).
 */
export const Divider: React.FC<DividerProps> = ({
  char = '─',
  color,
  dimColor = true,
  orientation = 'horizontal',
  boxProps,
}) => {
  const isVertical = orientation === 'vertical';

  if (isVertical) {
    return (
      <Box
        height="100%"
        borderStyle={{
          top: '',
          bottom: '',
          left: '',
          right: char,
          topLeft: '',
          topRight: '',
          bottomLeft: '',
          bottomRight: '',
        }}
        borderColor={color}
        borderDimColor={dimColor}
        borderRight={true}
        borderBottom={false}
        borderTop={false}
        borderLeft={false}
        {...boxProps}
      />
    );
  }

  // Horizontal divider
  return (
    <Box
      flexGrow={1} // KEY: Fills available horizontal space
      borderStyle={{
        top: '',
        bottom: char, // KEY: Divider character
        left: '',
        right: '',
        topLeft: '',
        topRight: '',
        bottomLeft: '',
        bottomRight: '',
      }}
      borderColor={color}
      borderDimColor={dimColor}
      borderBottom={true} // KEY: Renders bottom border
      borderTop={false}
      borderLeft={false}
      borderRight={false}
      {...boxProps}
    />
  );
};

interface DividerWithTitleProps extends DividerProps {
  /**
   * Title text to display in the center of the divider.
   */
  title: string;
}

/**
 * A divider with a centered title text.
 * Used for section headers, like Claude's truncation indicator.
 *
 * Example: ──────── Show 50 previous messages ────────
 */
export const DividerWithTitle: React.FC<DividerWithTitleProps> = ({
  title,
  char = '─',
  color,
  dimColor = true,
  boxProps,
}) => {
  return (
    <Box flexDirection="row" {...boxProps}>
      <Divider char={char} color={color} dimColor={dimColor} />
      <Text dimColor={dimColor} color={color}> {title} </Text>
      <Divider char={char} color={color} dimColor={dimColor} />
    </Box>
  );
};
