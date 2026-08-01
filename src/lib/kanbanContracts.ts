export const KANBAN_COLUMN_IDS = [
  'backlog',
  'in-progress',
  'blocked',
  'done',
] as const
export const KANBAN_PRIORITY_IDS = [
  'none',
  'low',
  'medium',
  'high',
  'urgent',
] as const
export const KANBAN_ISSUE_TYPE_IDS = ['task', 'bug', 'idea'] as const

export type KanbanColumnId = (typeof KANBAN_COLUMN_IDS)[number]
export type KanbanPriority = (typeof KANBAN_PRIORITY_IDS)[number]
export type KanbanIssueType = (typeof KANBAN_ISSUE_TYPE_IDS)[number]

export interface KanbanColumnDefinition {
  description: string
  id: KanbanColumnId
  title: string
}

export interface KanbanCreateCardInput {
  acceptanceCriteria?: readonly KanbanAcceptanceCriterionInput[]
  assignee?: string
  columnId?: KanbanColumnId
  description?: string
  issueType?: KanbanIssueType
  labels?: readonly string[]
  parentCardId?: string | null
  position?: number
  priority?: KanbanPriority
  sourceMessageId?: string
  title: string
}

export interface KanbanUpdateCardInput {
  acceptanceCriteria?: readonly KanbanAcceptanceCriterionInput[]
  assignee?: string | null
  cardId: string
  columnId: KanbanColumnId
  description: string
  issueType?: KanbanIssueType
  labels?: readonly string[]
  parentCardId?: string | null
  priority?: KanbanPriority
  title: string
}

export interface KanbanUpdateCardContentInput {
  acceptanceCriteria?: readonly KanbanAcceptanceCriterionInput[]
  assignee?: string | null
  cardId: string
  description?: string
  issueType?: KanbanIssueType
  labels?: readonly string[]
  parentCardId?: string | null
  priority?: KanbanPriority
  title?: string
}

export interface KanbanDeleteCardInput {
  cardId: string
  deleteSubtasks?: boolean
}

export interface KanbanAcceptanceCriterionInput {
  completed?: boolean
  id?: string
  text: string
}

export interface KanbanAcceptanceCriterion {
  completed: boolean
  id: string
  text: string
}

export interface KanbanSubtaskDraft extends Omit<
  KanbanCreateCardInput,
  'parentCardId' | 'sourceMessageId'
> {
  title: string
}

export interface KanbanCreateTaskInput extends KanbanCreateCardInput {
  subtasks?: readonly KanbanSubtaskDraft[]
}

export interface KanbanCreateTaskResult {
  parent: KanbanCard
  subtasks: KanbanCard[]
}

export interface KanbanTaskPlanInput {
  description?: string
  title: string
  workspacePath: string | null
}

export interface KanbanTaskPlan {
  acceptanceCriteria: string[]
  description: string
  labels: string[]
  subtasks: string[]
}

export interface KanbanReorderInput {
  cardId: string
  targetColumnId: KanbanColumnId
  targetIndex: number
}

export interface KanbanCard {
  acceptanceCriteria: KanbanAcceptanceCriterion[]
  assignee?: string
  columnId: KanbanColumnId
  createdAt: number
  description: string
  id: string
  issueType: KanbanIssueType
  labels: string[]
  parentCardId?: string
  position: number
  priority: KanbanPriority
  revision: number
  sourceMessageId?: string
  title: string
  updatedAt: number
}

export interface KanbanBoardData {
  cards: KanbanCard[]
  revision: number
}

export interface KanbanCardSummary {
  childCount: number
  columnId: KanbanColumnId
  doneChildCount: number
  id: string
  issueType: KanbanIssueType
  labels: string[]
  parentCardId?: string
  priority: KanbanPriority
  title: string
  updatedAt: number
}

export interface KanbanCardDetails {
  card: KanbanCard
  childCount: number
  children: KanbanCardSummary[]
  doneChildCount: number
}

export interface KanbanColumnReadInput {
  columnId: KanbanColumnId
  cursor?: string
  includeCounts?: boolean
  limit?: number
}

export interface KanbanColumnReadResult {
  cards: KanbanCardSummary[]
  column: {
    count: number
    id: KanbanColumnId
    title: string
  }
  counts?: Record<KanbanColumnId, number>
  nextCursor: string | null
}

export interface KanbanReadCardInput {
  cardId: string
}

export interface KanbanMoveInput {
  cardId: string
  targetColumnId: KanbanColumnId
}

export interface KanbanWorkspaceInput {
  workspacePath: string | null
}

export type KanbanReadBoardRequest = KanbanWorkspaceInput &
  KanbanColumnReadInput
export type KanbanReadCardRequest = KanbanWorkspaceInput & KanbanReadCardInput
export type KanbanCreateCardRequest = KanbanWorkspaceInput &
  KanbanCreateCardInput
export type KanbanCreateTaskRequest = KanbanWorkspaceInput &
  KanbanCreateTaskInput
export type KanbanUpdateCardRequest = KanbanWorkspaceInput &
  KanbanUpdateCardContentInput
export type KanbanMoveCardRequest = KanbanWorkspaceInput & KanbanMoveInput
export type KanbanReorderCardRequest = KanbanWorkspaceInput & KanbanReorderInput
export type KanbanDeleteCardRequest = KanbanWorkspaceInput &
  KanbanDeleteCardInput

export interface KanbanSourceMessage<MessageValue = unknown> {
  id: string
  label: string
  message: MessageValue
}
