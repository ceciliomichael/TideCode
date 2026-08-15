import type { AppTerminalExecutionMode } from '../../../src/types/chat'
import type { WebContents } from 'electron'
import type { ToolInvocationResultPresentation } from '../../../src/types/chat'
import type { ToolResultOutput } from '@ai-sdk/provider-utils'
import type { ChatStreamEventTarget } from './runtimeStreamEvents'

export interface AgentToolResultSubject {
  kind?: string
  path?: string
}

export interface AgentToolExecutionResult {
  body?: string
  displayBody?: string
  modelOutput?: ToolResultOutput
  resultPresentation?: ToolInvocationResultPresentation
  semantics?: Record<string, unknown>
  status: 'error' | 'success'
  subject?: AgentToolResultSubject
  summary: string
  truncated?: boolean
}

export interface AgentToolContext {
  checkpointId?: string | null
  conversationId?: string | null
  turnId?: string | null
  terminalExecutionMode?: AppTerminalExecutionMode
  workspaceRootPath: string
  webContents?: WebContents | ChatStreamEventTarget | null
}
