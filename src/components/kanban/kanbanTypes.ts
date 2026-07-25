import type { Message } from '../../types/chat'
import type { KanbanSourceMessage as SharedKanbanSourceMessage } from '../../lib/kanban'

export type {
  KanbanAcceptanceCriterion,
  KanbanAcceptanceCriterionInput,
  KanbanBoardData,
  KanbanCard,
  KanbanColumnDefinition,
  KanbanColumnId,
  KanbanCreateCardInput,
  KanbanCreateTaskInput,
  KanbanCreateTaskResult,
  KanbanDeleteCardInput,
  KanbanIssueType,
  KanbanMoveInput,
  KanbanPriority,
  KanbanReorderInput,
  KanbanSubtaskDraft,
  KanbanUpdateCardInput,
} from '../../lib/kanban'

export type KanbanSourceMessage = SharedKanbanSourceMessage<Message>
