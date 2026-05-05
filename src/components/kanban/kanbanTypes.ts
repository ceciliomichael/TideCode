import type { Message } from '../../types/chat'

export type KanbanColumnId = 'backlog' | 'in-progress' | 'blocked' | 'done'

export interface KanbanColumnDefinition {
  description: string
  id: KanbanColumnId
  title: string
}

export interface KanbanCreateCardInput {
  columnId?: KanbanColumnId
  description?: string
  sourceMessageId?: string
  title: string
}

export interface KanbanUpdateCardInput {
  cardId: string
  columnId: KanbanColumnId
  description: string
  title: string
}

export interface KanbanDeleteCardInput {
  cardId: string
}

export interface KanbanCard {
  columnId: KanbanColumnId
  createdAt: number
  description: string
  id: string
  sourceMessageId?: string
  title: string
  updatedAt: number
}

export interface KanbanBoardData {
  cards: KanbanCard[]
}

export interface KanbanSourceMessage {
  id: string
  label: string
  message: Message
}

export interface KanbanMoveInput {
  cardId: string
  targetColumnId: KanbanColumnId
}
