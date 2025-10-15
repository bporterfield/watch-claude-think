export interface ThinkingContent {
  type: "thinking";
  thinking: string;
  signature?: string;
}

export interface TextContent {
  type: "text";
  text: string;
}

export interface ToolUseContent {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultContent {
  type: "tool_result";
  tool_use_id: string;
  content: string | unknown;
  is_error?: boolean;
}

export interface ImageContent {
  type: "image";
  source: {
    type: string;
    data: string;
  };
}

export type MessageContent =
  | ThinkingContent
  | TextContent
  | ToolUseContent
  | ToolResultContent
  | ImageContent;

export interface MessageUsage {
  input_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
  output_tokens: number;
  service_tier?: string;
}

export interface AssistantMessage {
  model: string;
  id: string;
  type: "message";
  role: "assistant";
  content: MessageContent[];
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: MessageUsage;
}

export interface UserMessage {
  role: "user";
  content: string | Array<{ type: string; [key: string]: unknown }>;
}

export interface ReadToolResult {
  type: "text";
  file: {
    filePath: string;
    content: string;
    numLines: number;
    startLine: number;
    totalLines: number;
  };
}

export interface GlobToolResult {
  filenames: string[];
  durationMs: number;
  numFiles: number;
  truncated: boolean;
  mode?: string;
}

export interface BashToolResult {
  stdout: string;
  stderr: string;
  interrupted: boolean;
  isImage: boolean;
}

export interface EditToolResult {
  filePath: string;
  oldString: string;
  newString: string;
  originalFile: string;
  structuredPatch: unknown;
  userModified: boolean;
  replaceAll: boolean;
}

export type ToolUseResult =
  | ReadToolResult
  | GlobToolResult
  | BashToolResult
  | EditToolResult
  | string;

export interface ClaudeMessageEntry {
  parentUuid: string | null;
  isSidechain: boolean;
  userType: string;
  cwd: string;
  sessionId: string;
  version: string;
  gitBranch: string;
  type: "assistant" | "user";
  message: AssistantMessage | UserMessage;
  requestId?: string;
  uuid: string;
  timestamp: string;
  isMeta?: boolean; // True for system messages (caveats, system-reminders, etc.)
  isApiErrorMessage?: boolean; // True for synthetic assistant error messages
  isCompactSummary?: boolean; // True for user messages containing compact summaries
  isVisibleInTranscriptOnly?: boolean; // True for messages only visible in transcript
  thinkingMetadata?: {
    level: string;
    disabled: boolean;
    triggers: string[];
  };
  toolUseResult?: ToolUseResult;
}

export interface FileHistorySnapshot {
  type: "file-history-snapshot";
  messageId: string;
  snapshot: {
    messageId: string;
    trackedFileBackups: Record<string, unknown>;
    timestamp: string;
  };
  isSnapshotUpdate: boolean;
}

export interface SummaryEntry {
  type: "summary";
  summary: string;
  leafUuid: string;
}

export interface SystemEntry {
  type: "system";
  subtype: "local_command" | "compact_boundary" | "api_error";
  content?: string;
  level: "info" | "error";
  parentUuid: string | null;
  logicalParentUuid?: string; // For compact_boundary subtype
  isSidechain: boolean;
  userType: string;
  cwd: string;
  sessionId: string;
  version: string;
  gitBranch: string;
  timestamp: string;
  uuid: string;
  isMeta: boolean;

  // For compact_boundary subtype
  compactMetadata?: {
    trigger: string;
    preTokens: number;
  };

  // For api_error subtype
  error?: object;
  retryInMs?: number;
  retryAttempt?: number;
  maxRetries?: number;
}

export type JSONLEntry = ClaudeMessageEntry | FileHistorySnapshot | SummaryEntry | SystemEntry;
