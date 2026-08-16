import type {
  ApiKeyProviderId,
  ChatMode,
  AppTerminalExecutionMode,
  Message,
  ReasoningEffort,
} from '../../src/types/chat'
import type { SelectOptions } from './interactiveSelect'
import type { ChecklistOptions } from './interactiveChecklist'
import type { FollowUpBehavior } from '../../src/lib/appSettings'
import type { ResumeConversationItem } from './resumeCatalog'
import type { ResumeSelectionResult } from './interactiveResumeSelect'
import type { ResumePage } from './terminalResumeView'
import type { TextInputOptions } from './interactiveTextInput'

export interface CliOptions {
  prompt?: string
  model?: string
  provider?: ApiKeyProviderId | 'codex'
  mode?: ChatMode
  continueId?: string
  resume?: boolean
  remote?: boolean
  port?: number
  help?: boolean
  version?: boolean
  workspacePath?: string
  terminalExecutionMode?: AppTerminalExecutionMode
}

export interface CliSessionState {
  conversationId: string
  workspaceRootPath: string
  modelId: string
  providerId: ApiKeyProviderId | 'codex'
  chatMode: ChatMode
  terminalExecutionMode: AppTerminalExecutionMode
  reasoningEffort: ReasoningEffort
  messages: Message[]
  isStreaming: boolean
  activeStreamId: string | null
  followUpBehavior?: FollowUpBehavior
  pendingUndoEdit?: {
    targetUserMessageId: string
  }
}

export interface MentionMatch {
  relativePath: string
  absolutePath: string
  isDirectory: boolean
  label: string
}

export interface SlashCommandDefinition {
  name: string
  alias?: string
  description: string
  usage: string
  execute: (
    args: string[],
    state: CliSessionState,
    helpers: SlashCommandHelpers,
  ) => Promise<boolean | void>
}

export interface SlashCommandHelpers {
  renderInfo: (message: string) => void
  renderSuccess: (message: string) => void
  renderWarning: (message: string) => void
  renderError: (message: string) => void
  renderDiff: (diffText: string) => void
  switchModel: (modelId: string, providerId?: ApiKeyProviderId | 'codex') => Promise<void>
  switchReasoningEffort: (effort: ReasoningEffort, modelLabel: string) => Promise<void>
  switchMode: (mode: ChatMode) => void
  compactHistory: () => Promise<void>
  undoLastTurn: () => Promise<void>
  loadSession: (conversationId: string) => Promise<boolean>
  setConversationArchived: (conversationId: string, isArchived: boolean) => Promise<boolean>
  selectResume: (
    items: readonly ResumeConversationItem[],
    workspacePath: string,
    projectLabel: string,
    page?: ResumePage,
  ) => Promise<ResumeSelectionResult | null>
  clearSession: () => Promise<void>
  startRemoteDaemon: () => Promise<void>
  select: <T>(options: SelectOptions<T>) => Promise<T | null>
  input: (options: TextInputOptions) => Promise<string | null>
  checklist: <T>(options: ChecklistOptions<T>) => Promise<T[] | null>
  confirm: (question: string, defaultYes?: boolean) => Promise<boolean>
  exit: () => void
}

export interface ParsedMention {
  raw: string
  filePath: string
  startLine?: number
  endLine?: number
  isSpecial?: boolean
  specialType?: 'diff' | 'staged' | 'git' | 'problems'
}

export interface ToolApprovalPromptRequest {
  toolName: string
  argumentsText: string
  description?: string
}

export type ToolApprovalPromptResponse = 'allow' | 'deny' | 'always_allow' | 'edit'
