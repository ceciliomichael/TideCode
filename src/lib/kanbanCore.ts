import {
  KANBAN_COLUMN_IDS,
  KANBAN_ISSUE_TYPE_IDS,
  KANBAN_PRIORITY_IDS,
  type KanbanAcceptanceCriterion,
  type KanbanBoardData,
  type KanbanCard,
  type KanbanColumnId,
  type KanbanIssueType,
  type KanbanPriority,
} from './kanbanContracts'

export const DEFAULT_COLUMN_ID: KanbanColumnId = 'backlog'
export const DEFAULT_PRIORITY: KanbanPriority = 'none'
export const DEFAULT_ISSUE_TYPE: KanbanIssueType = 'task'
export const DEFAULT_READ_LIMIT = 20
export const MAX_READ_LIMIT = 50
const MAX_LABEL_COUNT = 12
const MAX_LABEL_LENGTH = 32
const MAX_ACCEPTANCE_CRITERIA = 30

export function isKanbanColumnId(value: unknown): value is KanbanColumnId {
  return (
    typeof value === 'string' &&
    KANBAN_COLUMN_IDS.includes(value as KanbanColumnId)
  )
}

// Keep existing boards readable after the column rename.
function normalizeStoredKanbanColumnId(
  value: unknown,
): KanbanColumnId | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalizedValue = value === 'blocked' ? 'for-review' : value
  return isKanbanColumnId(normalizedValue) ? normalizedValue : undefined
}

export function assertKanbanColumnId(
  value: unknown,
  fieldName = 'columnId',
): KanbanColumnId {
  if (!isKanbanColumnId(value)) {
    throw new Error(
      `${fieldName} must be one of: ${KANBAN_COLUMN_IDS.join(', ')}.`,
    )
  }

  return value
}

export function isKanbanPriority(value: unknown): value is KanbanPriority {
  return (
    typeof value === 'string' &&
    KANBAN_PRIORITY_IDS.includes(value as KanbanPriority)
  )
}

export function isKanbanIssueType(value: unknown): value is KanbanIssueType {
  return (
    typeof value === 'string' &&
    KANBAN_ISSUE_TYPE_IDS.includes(value as KanbanIssueType)
  )
}

export function normalizeKanbanWorkspacePath(
  workspacePath: string | null | undefined,
) {
  const normalizedWorkspacePath = workspacePath?.trim()
  if (!normalizedWorkspacePath) {
    throw new Error('A workspace path is required for kanban board access.')
  }

  return normalizedWorkspacePath
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function normalizeParentCardId(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined
}

export function normalizeOptionalText(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined
}

export function normalizeLabels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  const normalizedLabels = value
    .filter((label): label is string => typeof label === 'string')
    .map((label) => label.trim())
    .filter((label) => label.length > 0 && label.length <= MAX_LABEL_LENGTH)

  return [...new Set(normalizedLabels)].slice(0, MAX_LABEL_COUNT)
}

export function normalizeAcceptanceCriteria(
  value: unknown,
  cardId: string,
): KanbanAcceptanceCriterion[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter(isRecord)
    .map((criterion, index) => {
      const text =
        typeof criterion.text === 'string' ? criterion.text.trim() : ''
      if (!text) {
        return null
      }

      return {
        completed: criterion.completed === true,
        id:
          normalizeOptionalText(criterion.id) ??
          `${cardId}:criterion:${index + 1}`,
        text,
      }
    })
    .filter(
      (criterion): criterion is KanbanAcceptanceCriterion => criterion !== null,
    )
    .slice(0, MAX_ACCEPTANCE_CRITERIA)
}

export function isTopLevelKanbanCard(card: KanbanCard) {
  return card.parentCardId === undefined
}

export function getKanbanCardById(boardData: KanbanBoardData, cardId: string) {
  return boardData.cards.find((card) => card.id === cardId) ?? null
}

export function getKanbanCardChildrenInternal(
  boardData: KanbanBoardData,
  parentCardId: string,
) {
  return boardData.cards.filter((card) => card.parentCardId === parentCardId)
}

export function getKanbanCardChildCountsInternal(
  boardData: KanbanBoardData,
  parentCardId: string,
) {
  const children = getKanbanCardChildrenInternal(boardData, parentCardId)
  const doneChildCount = children.filter(
    (card) => card.columnId === 'done',
  ).length

  return {
    childCount: children.length,
    doneChildCount,
  }
}

export function validateKanbanParentCardLink(
  boardData: KanbanBoardData,
  parentCardIdInput: string | null | undefined,
  cardId?: string,
) {
  const parentCardId = normalizeParentCardId(parentCardIdInput)
  if (!parentCardId) {
    return undefined
  }

  if (cardId && parentCardId === cardId) {
    throw new Error('A task cannot be its own parent.')
  }

  const parentCard = getKanbanCardById(boardData, parentCardId)
  if (!parentCard) {
    throw new Error(`Parent task not found: ${parentCardId}`)
  }

  if (!isTopLevelKanbanCard(parentCard)) {
    throw new Error('Parent task must be a top-level task.')
  }

  return parentCardId
}

function sanitizeKanbanBoardCards(cards: readonly KanbanCard[]): KanbanCard[] {
  const topLevelCardIds = new Set(
    cards
      .filter((card) => card.parentCardId === undefined)
      .map((card) => card.id),
  )

  return cards.map((card) => {
    const parentCardId = normalizeParentCardId(card.parentCardId)
    if (
      !parentCardId ||
      parentCardId === card.id ||
      !topLevelCardIds.has(parentCardId)
    ) {
      const cardWithoutParent = { ...card }
      delete cardWithoutParent.parentCardId
      return cardWithoutParent
    }

    return {
      ...card,
      parentCardId,
    }
  })
}

export function normalizeKanbanBoardData(
  boardData: KanbanBoardData,
): KanbanBoardData {
  return {
    cards: sanitizeKanbanBoardCards(boardData.cards),
    revision:
      Number.isFinite(boardData.revision) && boardData.revision >= 0
        ? Math.floor(boardData.revision)
        : 0,
  }
}

export function parseKanbanCard(value: unknown): KanbanCard | null {
  if (!isRecord(value)) {
    return null
  }

  const columnId = normalizeStoredKanbanColumnId(value.columnId)
  if (
    typeof value.id !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.description !== 'string' ||
    typeof value.createdAt !== 'number' ||
    typeof value.updatedAt !== 'number' ||
    !columnId
  ) {
    return null
  }

  const parentCardId = normalizeParentCardId(value.parentCardId)
  const sourceMessageId =
    typeof value.sourceMessageId === 'string'
      ? value.sourceMessageId
      : undefined

  return {
    acceptanceCriteria: normalizeAcceptanceCriteria(
      value.acceptanceCriteria,
      value.id,
    ),
    assignee: normalizeOptionalText(value.assignee),
    columnId,
    createdAt: value.createdAt,
    description: value.description,
    id: value.id,
    issueType: isKanbanIssueType(value.issueType)
      ? value.issueType
      : DEFAULT_ISSUE_TYPE,
    labels: normalizeLabels(value.labels),
    ...(parentCardId ? { parentCardId } : {}),
    position:
      typeof value.position === 'number' && Number.isFinite(value.position)
        ? value.position
        : value.createdAt,
    priority: isKanbanPriority(value.priority)
      ? value.priority
      : DEFAULT_PRIORITY,
    revision:
      typeof value.revision === 'number' && value.revision >= 0
        ? Math.floor(value.revision)
        : 0,
    ...(sourceMessageId ? { sourceMessageId } : {}),
    title: value.title,
    updatedAt: value.updatedAt,
  }
}

export function parseKanbanBoardData(value: unknown): KanbanBoardData {
  if (!isRecord(value) || !Array.isArray(value.cards)) {
    return { cards: [], revision: 0 }
  }

  return normalizeKanbanBoardData({
    cards: value.cards
      .map(parseKanbanCard)
      .filter((card): card is KanbanCard => card !== null),
    revision: typeof value.revision === 'number' ? value.revision : 0,
  })
}
