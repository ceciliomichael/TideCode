export type TerminalBrokerClientKind = 'desktop' | 'cli' | 'ai' | 'remote' | 'system'

export type TerminalBrokerOwnerKind = 'visible' | 'ai' | 'cli' | 'remote'

export type TerminalBrokerSessionState =
  | 'creating'
  | 'ready'
  | 'busy'
  | 'needs_interaction'
  | 'exited'
  | 'terminating'
  | 'terminated'
  | 'termination_failed'
  | 'orphaned'
  | 'session_lost'

export type TerminalBrokerOperationState =
  | 'queued'
  | 'writing'
  | 'running'
  | 'needs_interaction'
  | 'completed'
  | 'command_failed'
  | 'cancel_requested'
  | 'terminating'
  | 'terminated'
  | 'termination_failed'
  | 'session_lost'

export type TerminalCancellationReason =
  | 'run_completed'
  | 'user_stop'
  | 'message_revert'
  | 'message_edit'
  | 'conversation_delete'
  | 'run_replaced'
  | 'surface_shutdown'
  | 'provider_timeout'
  | 'provider_failure'
  | 'service_shutdown'
  | 'unknown'

export type TerminalCancellationPolicy = 'detach' | 'terminate' | 'terminate_after_grace'

export interface TerminalCancellationProvenance {
  conversationId?: string | null
  policy: TerminalCancellationPolicy
  reason: TerminalCancellationReason
  requestedAt: number
  runId?: string | null
  surface: TerminalBrokerClientKind
}

export interface TerminalBrokerShellMetadata {
  args: string[]
  command: string
  kind: 'powershell' | 'command-prompt' | 'posix' | 'other'
  label: string
  resolutionSource: 'configured' | 'terminal-profile' | 'system' | 'fallback' | 'unknown'
  version: string | null
}

export interface TerminalBrokerSessionSnapshot {
  attachedClientIds: string[]
  brokerSessionId: string
  cols: number
  conversationId: string | null
  createdAt: number
  createdByClientId: string
  cwd: string
  exitCode: number | null
  label: string | null
  lastActivityAt: number
  legacySessionId: number
  operationIds: string[]
  ownerKind: TerminalBrokerOwnerKind
  processId: number | null
  rows: number
  runId: string | null
  shell: TerminalBrokerShellMetadata
  signal: number | null
  state: TerminalBrokerSessionState
  termination: TerminalCancellationProvenance | null
  transcriptEndCursor: number
  transcriptStartCursor: number
  workspaceRootPath: string
}

export interface TerminalBrokerOperationSnapshot {
  brokerSessionId: string
  command: string
  completedAt: number | null
  createdAt: number
  cwd: string
  endCursor: number | null
  exitCode: number | null
  operationId: string
  runId: string | null
  startCursor: number
  startedAt: number | null
  state: TerminalBrokerOperationState
  termination: TerminalCancellationProvenance | null
  toolCallId: string | null
}

export interface TerminalBrokerOutputSlice {
  brokerSessionId: string
  data: string
  endCursor: number
  outputEvicted: boolean
  startCursor: number
}

export interface TerminalBrokerCreateSessionInput {
  clientId: string
  cols: number
  conversationId?: string | null
  cwd?: string | null
  label?: string | null
  ownerKind: TerminalBrokerOwnerKind
  rows: number
  runId?: string | null
  sessionKey?: string | null
  workspaceRootPath?: string | null
}

export interface TerminalBrokerCreateSessionResult {
  bufferedOutput: string
  brokerSessionId: string
  cwd: string
  isReused: boolean
  legacySessionId: number
  shell: TerminalBrokerShellMetadata
  snapshot: TerminalBrokerSessionSnapshot
  venvName: string | null
  workspaceRootPath: string
}

export interface TerminalBrokerSessionReference {
  brokerSessionId?: string | null
  clientId: string
  legacySessionId?: number | null
  workspaceRootPath?: string | null
}

export interface TerminalBrokerAttachInput extends TerminalBrokerSessionReference {
  cursor?: number
}

export interface TerminalBrokerAttachResult {
  output: TerminalBrokerOutputSlice
  session: TerminalBrokerSessionSnapshot
}

export interface TerminalBrokerWriteInput extends TerminalBrokerSessionReference {
  data: string
}

export interface TerminalBrokerResizeInput extends TerminalBrokerSessionReference {
  cols: number
  rows: number
}

export interface TerminalBrokerReadInput extends TerminalBrokerSessionReference {
  cursor?: number
  pollingMs?: number
}

export interface TerminalBrokerTerminateInput extends TerminalBrokerSessionReference {
  provenance: TerminalCancellationProvenance
}

export type TerminalBrokerEvent =
  | {
      clientIds: string[]
      legacySessionId: number
      output: TerminalBrokerOutputSlice
      type: 'terminal_output'
    }
  | {
      clientIds: string[]
      session: TerminalBrokerSessionSnapshot
      type: 'terminal_session_changed'
    }
  | {
      clientIds: string[]
      operation: TerminalBrokerOperationSnapshot
      type: 'terminal_operation_changed'
    }
  | {
      clientIds: string[]
      error: string
      session: TerminalBrokerSessionSnapshot
      type: 'terminal_cleanup_failed'
    }
