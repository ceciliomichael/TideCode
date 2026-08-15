import type { ChatStreamEvent, StartChatStreamInput } from './runtime'
import type { ConversationRecord } from './conversations'

export type SharedRunStatus =
  | 'starting'
  | 'running'
  | 'waiting_for_input'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

export interface SharedRunSnapshot {
  runId: string
  streamId: string | null
  conversationId: string
  providerId: StartChatStreamInput['providerId']
  modelId: string
  workspaceRootPath: string
  status: SharedRunStatus
  startedAt: number
  updatedAt: number
  lastEventSeq: number
}

export type TideCodeRunEvent =
  | {
      type: 'run_state'
      seq: number
      run: SharedRunSnapshot
    }
  | {
      type: 'chat_event'
      seq: number
      runId: string
      conversationId: string
      event: ChatStreamEvent
    }
  | {
      type: 'conversation_updated'
      seq: number
      runId: string
      conversationId: string
      conversation: ConversationRecord
    }

export interface TideCodeRunsApi {
  listActiveRuns: () => Promise<SharedRunSnapshot[]>
  onEvent: (listener: (event: TideCodeRunEvent) => void) => () => void
}
