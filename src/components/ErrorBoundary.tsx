import React, { Component, type ReactNode } from 'react';
import { Box, Text } from 'ink';
import { logger } from '../lib/logger.js';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error) => ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary component for catching and handling React errors
 *
 * Prevents the entire app from crashing when a component throws an error.
 * Logs the error and displays a user-friendly fallback UI.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Log the error with component stack
    logger.error('React component error caught by boundary', error, {
      componentStack: errorInfo.componentStack,
    });
  }

  override render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback(this.state.error);
      }

      // Default fallback UI
      return (
        <Box flexDirection="column" padding={1}>
          <Text bold color="red">
            Error: Something went wrong
          </Text>
          <Text color="red">{this.state.error.message}</Text>
          <Text dimColor>
            Check the logs for more details. Press Ctrl+C to exit.
          </Text>
        </Box>
      );
    }

    return this.props.children;
  }
}
