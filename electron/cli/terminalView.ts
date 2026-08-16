import type { ChatMode } from '../../src/types/chat'

export type TranscriptEntry =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; section?: 'work' | 'answer' }
  | { kind: 'thought'; id: string; text?: string; durationSeconds?: number }
  | { kind: 'compaction'; id: string }
  | { kind: 'tool'; id: string; label: string; status: 'running' | 'completed' | 'failed'; detail?: string; diff?: string }
  | { kind: 'notice'; id: string; level: 'info' | 'success' | 'warning' | 'error'; text: string }

export interface TerminalSessionView {
  workspace: string
  model: string
  provider: string
  mode: ChatMode
  version: string
  permissions?: string
}

export interface TerminalActivityView {
  kind: 'idle' | 'thinking' | 'tool'
  label: string
  detail?: string
}

export interface ActiveTurnFollowUpView {
  behavior: 'steer' | 'queue'
  text: string
}

export interface CompletionItemView {
  value: string
  label: string
  description?: string
  mentionPath?: string
  mentionKind?: 'file' | 'folder' | 'skill'
}

export interface TerminalSelectionView<T = unknown> {
  title: string
  items: readonly {
    value: T
    label: string
    description?: string
    badge?: string
    isCurrent?: boolean
  }[]
  selectedIndex: number
  pageSize: number
  footer?: string
}

export interface TerminalScreenViewState {
  session: TerminalSessionView
  entries: TranscriptEntry[]
  activity: TerminalActivityView
  notification: { level: 'info' | 'success' | 'warning' | 'error'; text: string } | null
  completionItems: readonly CompletionItemView[]
  completionIndex: number
  selection: TerminalSelectionView | null
  scrollOffset: number
  isStreaming: boolean
}

export function createTerminalScreenView(session: TerminalSessionView): TerminalScreenViewState {
  return {
    session,
    entries: [],
    activity: { kind: 'idle', label: '' },
    notification: null,
    completionItems: [],
    completionIndex: 0,
    selection: null,
    scrollOffset: 0,
    isStreaming: false,
  }
}

export function nextTranscriptId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
