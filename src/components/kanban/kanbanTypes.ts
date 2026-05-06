import type { Message } from '../../types/chat'
import type { KanbanSourceMessage as SharedKanbanSourceMessage } from '../../lib/kanban'

export type {
  KanbanBoardData,
  KanbanCard,
  KanbanColumnDefinition,
  KanbanColumnId,
  KanbanCreateCardInput,
  KanbanDeleteCardInput,
  KanbanMoveInput,
  KanbanUpdateCardInput,
} from '../../lib/kanban'

export type KanbanSourceMessage = SharedKanbanSourceMessage<Message>
