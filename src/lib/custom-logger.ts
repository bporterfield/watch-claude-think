/**
 * Custom Render Logger
 * Based on Claude Code's RenderLogger
 *
 * Tracks accumulated static content and generates efficient terminal operations
 * for rendering without React overhead
 */

import { type TerminalOperation, countTerminalLines } from './terminal-ops.js';
import { logger } from './logger.js';

/**
 * Frame representing current render state
 */
export interface RenderFrame {
  /** New static content to append (or empty on resize) */
  staticOutput: string;
  /** Dynamic content (footer) - freshly rendered */
  dynamicOutput: string;
  /** Terminal dimensions */
  columns: number;
  rows: number;
}

/**
 * Logger options
 */
export interface LoggerOptions {
  /** Terminal is TTY */
  isTTY: boolean;
  /** Debug mode - always full redraw */
  debug?: boolean;
}

/**
 * Logger state
 */
interface LoggerState {
  /** Accumulated static content over time */
  fullStaticOutput: string;
  /** Last dynamic output written (for clearing) */
  previousDynamicOutput: string;
  /** Previous frame for comparison */
  prevFrame: RenderFrame;
}

/**
 * Custom Render Logger
 *
 * Maintains accumulated static content and generates efficient terminal operations
 */
export class CustomRenderLogger {
  private options: LoggerOptions;
  private state: LoggerState;

  constructor(options: LoggerOptions, initialFrame: RenderFrame) {
    this.options = options;
    this.state = {
      fullStaticOutput: '',
      previousDynamicOutput: '',
      prevFrame: initialFrame,
    };
  }

  /**
   * Main entry point - generates terminal operations for current frame
   *
   * @param frame - Current render frame
   * @returns Array of terminal operations to execute
   */
  render(frame: RenderFrame): TerminalOperation[] {
    // Debug mode: always full redraw
    if (this.options.debug) {
      return this.getDebugOps(frame);
    }

    // Non-TTY: just write static output directly
    if (!this.options.isTTY) {
      this.state.prevFrame = frame;
      if (frame.staticOutput) {
        return [{ type: 'stdout', content: frame.staticOutput, scrollback: true }];
      }
      return [];
    }

    // Detect if full redraw needed (resize)
    if (this.shouldDoFullRedraw(frame)) {
      return this.getFullRedrawOps(frame);
    }

    // No changes - skip render
    if (
      !frame.staticOutput?.trim() &&
      frame.dynamicOutput === this.state.prevFrame.dynamicOutput
    ) {
      return [];
    }

    // Normal incremental render
    const ops: TerminalOperation[] = [
      ...this.getStaticOutputOps(frame),
      ...this.getDynamicOutputOps(frame),
    ];

    this.state.prevFrame = frame;

    if (ops.length === 0) return [];

    // Wrap in synchronized update to prevent flicker
    return [
      { type: 'synchronizedUpdateStart' },
      ...ops,
      { type: 'synchronizedUpdateEnd' },
    ];
  }

  /**
   * Check if full redraw is needed (resize)
   */
  private shouldDoFullRedraw(frame: RenderFrame): boolean {
    return (
      frame.columns !== this.state.prevFrame.columns ||
      frame.rows !== this.state.prevFrame.rows
    );
  }

  /**
   * Debug mode: full redraw every time
   */
  private getDebugOps(frame: RenderFrame): TerminalOperation[] {
    // Accumulate static output with blank line separator
    if (frame.staticOutput?.trim()) {
      if (this.state.fullStaticOutput) {
        // Add extra newline to ensure blank line between messages
        this.state.fullStaticOutput += '\n' + frame.staticOutput;
      } else {
        this.state.fullStaticOutput += frame.staticOutput;
      }
    }

    this.state.prevFrame = frame;

    return [
      { type: 'synchronizedUpdateStart' },
      { type: 'clearTerminal' },
      { type: 'stdout', content: this.state.fullStaticOutput, scrollback: true },
      { type: 'stdout', content: frame.dynamicOutput, scrollback: true },
      { type: 'stdout', content: '\n', scrollback: true },
      { type: 'synchronizedUpdateEnd' },
    ];
  }

  /**
   * Full redraw (resize) - THE KEY OPTIMIZATION!
   *
   * Clear terminal and rewrite:
   * 1. fullStaticOutput (accumulated string - NOT from React!)
   * 2. Fresh dynamic output (footer at new width)
   */
  private getFullRedrawOps(frame: RenderFrame): TerminalOperation[] {
    logger.debug('[CustomLogger] Full redraw (resize)', {
      oldColumns: this.state.prevFrame.columns,
      newColumns: frame.columns,
      fullStaticLength: this.state.fullStaticOutput.length,
      hasNewStatic: !!frame.staticOutput?.trim(),
    });

    // Accumulate new static output (if any) with blank line separator
    if (frame.staticOutput?.trim()) {
      if (this.state.fullStaticOutput) {
        // Add extra newline to ensure blank line between messages
        this.state.fullStaticOutput += '\n' + frame.staticOutput;
      } else {
        this.state.fullStaticOutput += frame.staticOutput;
      }
    }

    // Update state
    this.state.previousDynamicOutput = frame.dynamicOutput + '\n';
    this.state.prevFrame = frame;

    // Return operations for full redraw
    return [
      { type: 'synchronizedUpdateStart' },
      { type: 'clearTerminal' },

      // Write accumulated static content (pre-rendered string!)
      { type: 'stdout', content: this.state.fullStaticOutput, scrollback: true },

      // Write fresh dynamic content
      { type: 'stdout', content: frame.dynamicOutput, scrollback: true },
      { type: 'stdout', content: '\n', scrollback: true },

      { type: 'synchronizedUpdateEnd' },
    ];
  }

  /**
   * Handle static output (new messages)
   * Clear previous dynamic content, write new static, will re-render dynamic after
   */
  private getStaticOutputOps(frame: RenderFrame): TerminalOperation[] {
    // No new static content
    if (!frame.staticOutput?.trim()) {
      return [];
    }

    logger.debug('[CustomLogger] New static content', {
      length: frame.staticOutput.length,
    });

    // Check if we need extra newline before accumulating
    const needsExtraNewline = !!this.state.fullStaticOutput;

    // Accumulate the new static output with blank line separator
    if (this.state.fullStaticOutput) {
      // Add extra newline to ensure blank line between messages
      this.state.fullStaticOutput += '\n' + frame.staticOutput;
    } else {
      this.state.fullStaticOutput += frame.staticOutput;
    }

    // Calculate how many lines to clear (previous dynamic content)
    const linesToClear = this.state.previousDynamicOutput
      ? countTerminalLines(this.state.previousDynamicOutput, this.state.prevFrame.columns)
      : 0;

    // Reset previous output since we're clearing it
    this.state.previousDynamicOutput = '';

    const ops: TerminalOperation[] = [];

    // Clear previous dynamic content (footer)
    if (linesToClear > 0) {
      ops.push({ type: 'clear', count: linesToClear });
    }

    // Write new static content with proper spacing (appends to terminal scrollback)
    const contentToWrite = needsExtraNewline ? '\n' + frame.staticOutput : frame.staticOutput;
    ops.push({ type: 'stdout', content: contentToWrite, scrollback: true });

    return ops;
  }

  /**
   * Handle dynamic output (footer) - efficiently update it
   */
  private getDynamicOutputOps(frame: RenderFrame): TerminalOperation[] {
    const newOutput = frame.dynamicOutput + '\n';

    // No change in dynamic output
    if (newOutput === this.state.previousDynamicOutput) {
      return [];
    }

    logger.debug('[CustomLogger] Dynamic content changed');

    // Calculate lines to clear
    const linesToClear = this.state.previousDynamicOutput
      ? countTerminalLines(this.state.previousDynamicOutput, this.state.prevFrame.columns)
      : 0;

    this.state.previousDynamicOutput = newOutput;

    const ops: TerminalOperation[] = [];

    // Clear previous dynamic content
    if (linesToClear > 0) {
      ops.push({ type: 'clear', count: linesToClear });
    }

    // Write new dynamic content (NOT in scrollback - it's temporary)
    ops.push({ type: 'stdout', content: frame.dynamicOutput, scrollback: false });
    ops.push({ type: 'stdout', content: '\n', scrollback: false });

    return ops;
  }

  /**
   * Get accumulated static output (for debugging/testing)
   */
  getFullStaticOutput(): string {
    return this.state.fullStaticOutput;
  }

  /**
   * Clear all state (for cleanup)
   */
  clear(): void {
    this.state.fullStaticOutput = '';
    this.state.previousDynamicOutput = '';
  }
}
