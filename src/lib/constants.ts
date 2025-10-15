/**
 * Application-wide configuration constants
 *
 * Centralizes magic numbers to provide clear documentation and
 * a single source of truth for tuning application behavior.
 */

/**
 * Detect if running in CI environment
 */
const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';

/**
 * CI multiplier for timing-sensitive operations
 * File operations are slower in CI, so we need more conservative timeouts
 */
const CI_MULTIPLIER = isCI ? 2 : 1;

/**
 * Maximum number of message blocks to load initially
 *
 * Controls how many messages are loaded from disk on startup.
 * After initial load, all new messages are kept in memory (no limit).
 *
 * Default: 200 blocks (~10-20 recent messages per session when watching multiple)
 */
export const MAX_BLOCKS_INITAL_RENDER = 200;

/**
 * Number of bytes to read from the tail of large session files
 *
 * When loading a session file on startup, we only read the most recent
 * portion to avoid loading GB-sized files into memory.
 *
 * Default: 100KB (roughly 200-500 messages)
 */
export const FILE_TAIL_BYTES = 100 * 1024;

/**
 * Size of LRU cache for file read positions
 *
 * Tracks where we last read from each file to enable incremental parsing.
 * Limited size prevents unbounded growth when watching many sessions.
 *
 * Default: 100 entries (sufficient for most multi-session scenarios)
 */
export const POSITION_CACHE_SIZE = 100;

/**
 * Number of bytes to read when extracting the last message UUID
 *
 * Default: 10KB (enough for ~20-50 JSONL entries)
 */
export const LAST_MESSAGE_BYTES = 10 * 1024;

/**
 * Width of a terminal cursor in characters
 *
 * Used for text padding to ensure content doesn't touch the terminal edges.
 * The cursor is 1 character wide.
 */
export const CURSOR_WIDTH = 1;

/**
 * Minimum content width for markdown rendering
 *
 * Ensures readable text even in very narrow terminals.
 * Used in block-renderer and UserMessageBlock components.
 *
 * Default: 40 characters
 */
export const MIN_CONTENT_WIDTH = 40;

/**
 * Left padding for message content in spaces
 *
 * Indents message content for better visual hierarchy.
 * Used in block-renderer and component calculations.
 *
 * Default: 2 spaces
 */
export const CONTENT_LEFT_PADDING = 2;

/**
 * Default terminal width in columns
 *
 * Fallback when process.stdout.columns is unavailable.
 *
 * Default: 80 columns (standard terminal width)
 */
export const DEFAULT_TERMINAL_WIDTH = 80;

/**
 * Default terminal height in rows
 *
 * Fallback when process.stdout.rows is unavailable.
 *
 * Default: 24 rows (standard terminal height)
 */
export const DEFAULT_TERMINAL_HEIGHT = 24;

/**
 * Maximum number of visible items in select inputs
 *
 * Controls scrollable list display in ProjectSelector and SessionSelector.
 *
 * Default: 9 items
 */
export const SELECT_INPUT_VISIBLE_LIMIT = 9;

/**
 * Maximum length for session names before truncation
 *
 * Prevents excessively long session names in UI.
 * Truncated names get '...' appended.
 *
 * Default: 40 characters
 */
export const SESSION_NAME_MAX_LENGTH = 40;

/**
 * Number of characters to display from session ID
 *
 * Shows shortened session ID in session selector.
 *
 * Default: 8 characters (first 8 chars of UUID)
 */
export const SESSION_ID_DISPLAY_LENGTH = 8;

/**
 * File watcher stability threshold in milliseconds
 *
 * How long a file must be stable before triggering a change event.
 * Prevents multiple events during rapid file writes.
 *
 * Default: 200ms (400ms in CI)
 */
export const WATCHER_STABILITY_THRESHOLD = 200 * CI_MULTIPLIER;

/**
 * File watcher poll interval in milliseconds
 *
 * How often to check for file changes when using polling.
 *
 * Default: 50ms (100ms in CI)
 */
export const WATCHER_POLL_INTERVAL = 50 * CI_MULTIPLIER;

/**
 * Watcher settling delay in milliseconds
 *
 * Time to wait after chokidar 'ready' event before considering watcher fully active.
 * Prevents race conditions where files are created before watcher is fully watching.
 *
 * Default: 100ms (200ms in CI)
 */
export const WATCHER_READY_SETTLING_DELAY = 100 * CI_MULTIPLIER;

/**
 * Queue concurrency for file operations
 *
 * Serializes file operations to prevent race conditions.
 * Must be 1 to ensure proper ordering.
 *
 * Default: 1 (sequential processing)
 */
export const FILE_OPERATION_QUEUE_CONCURRENCY = 1;

/**
 * Conversion factor from bytes to megabytes
 *
 * Used for memory usage logging and display.
 *
 * Default: 1024 * 1024 (1 MB = 1,048,576 bytes)
 */
export const BYTES_TO_MB = 1024 * 1024;
