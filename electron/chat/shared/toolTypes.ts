import type { AppTerminalExecutionMode } from '../../../src/types/chat'
import type { WebContents } from 'electron'
import type { ToolInvocationResultPresentation } from '../../../src/types/chat'
import type { DynamicToolInvocationMetadata } from './tools/dynamicToolContracts'

export interface AgentToolResultSubject {
  kind?: string
  path?: string
}

export interface AgentToolExecutionResult {
  body?: string
  dynamicInvocation?: DynamicToolInvocationMetadata
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
  terminalExecutionMode?: AppTerminalExecutionMode
  workspaceRootPath: string
  webContents?: WebContents | null
}
