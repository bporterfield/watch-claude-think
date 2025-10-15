/**
 * Simple logging utility for consistent error handling
 *
 * Provides structured logging with context to help debug issues.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogContext = Record<string, unknown>;

/**
 * Log configuration
 */
const config = {
  // Default to error level - use LOG_LEVEL env var to see more (info, warn, debug)
  minLevel: (process.env.LOG_LEVEL as LogLevel) || 'error',
  // Log to file if LOG_FILE env var is set
  logFile: process.env.LOG_FILE || null,
};

/**
 * Write stream for log file (created lazily)
 */
let logFileStream: fs.WriteStream | null = null;

/**
 * Get or create log file stream
 */
function getLogFileStream(): fs.WriteStream | null {
  if (!config.logFile) {
    return null;
  }

  if (!logFileStream) {
    const logPath = config.logFile.startsWith('/')
      ? config.logFile
      : path.join(os.homedir(), config.logFile);

    logFileStream = fs.createWriteStream(logPath, { flags: 'a' });
  }

  return logFileStream;
}

/**
 * Log levels for filtering
 */
const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Format error for logging
 */
function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.message}${error.stack ? `\n${error.stack}` : ''}`;
  }
  return String(error);
}

/**
 * Format context object for logging
 */
function formatContext(context?: LogContext): string {
  if (!context || Object.keys(context).length === 0) {
    return '';
  }
  return ' ' + JSON.stringify(context);
}

/**
 * Core logging function
 */
function log(level: LogLevel, message: string, context?: LogContext): void {
  if (LOG_LEVELS[level] < LOG_LEVELS[config.minLevel]) {
    return;
  }

  const timestamp = new Date().toISOString();
  const formattedContext = formatContext(context);
  const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}${formattedContext}`;

  // Write to file if configured
  const stream = getLogFileStream();
  if (stream) {
    stream.write(logMessage + '\n');
  } else {
    // Otherwise write to console
    switch (level) {
      case 'error':
        console.error(logMessage);
        break;
      case 'warn':
        console.warn(logMessage);
        break;
      case 'info':
        console.info(logMessage);
        break;
      case 'debug':
        console.debug(logMessage);
        break;
    }
  }
}

/**
 * Logger interface
 */
export const logger = {
  /**
   * Log debug message (lowest priority)
   */
  debug(message: string, context?: LogContext): void {
    log('debug', message, context);
  },

  /**
   * Log informational message
   */
  info(message: string, context?: LogContext): void {
    log('info', message, context);
  },

  /**
   * Log warning message
   */
  warn(message: string, context?: LogContext): void {
    log('warn', message, context);
  },

  /**
   * Log error message (highest priority)
   */
  error(message: string, errorOrContext?: unknown, context?: LogContext): void {
    // Support both logger.error(msg, error) and logger.error(msg, context)
    if (errorOrContext instanceof Error || typeof errorOrContext === 'string') {
      const errorStr = formatError(errorOrContext);
      log('error', `${message}: ${errorStr}`, context);
    } else {
      log('error', message, errorOrContext as LogContext);
    }
  },

  /**
   * Log caught exception with stack trace
   */
  exception(message: string, error: unknown, context?: LogContext): void {
    const errorStr = formatError(error);
    log('error', `${message}: ${errorStr}`, context);
  },
};
