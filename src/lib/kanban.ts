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

const DEFAULT_COLUMN_ID: KanbanColumnId = 'backlog'
const DEFAULT_PRIORITY: KanbanPriority = 'none'
const DEFAULT_ISSUE_TYPE: KanbanIssueType = 'task'
const DEFAULT_READ_LIMIT = 20
const MAX_READ_LIMIT = 50
const MAX_LABEL_COUNT = 12
const MAX_LABEL_LENGTH = 32
const MAX_ACCEPTANCE_CRITERIA = 30

export function isKanbanColumnId(value: unknown): value is KanbanColumnId {
  return (
    typeof value === 'string' &&
    KANBAN_COLUMN_IDS.includes(value as KanbanColumnId)
  )
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

function normalizeParentCardId(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined
}

function normalizeOptionalText(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined
}

function normalizeLabels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  const normalizedLabels = value
    .filter((label): label is string => typeof label === 'string')
    .map((label) => label.trim())
    .filter((label) => label.length > 0 && label.length <= MAX_LABEL_LENGTH)

  return [...new Set(normalizedLabels)].slice(0, MAX_LABEL_COUNT)
}

function normalizeAcceptanceCriteria(
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

function isTopLevelKanbanCard(card: KanbanCard) {
  return card.parentCardId === undefined
}

function getKanbanCardById(boardData: KanbanBoardData, cardId: string) {
  return boardData.cards.find((card) => card.id === cardId) ?? null
}

function getKanbanCardChildrenInternal(
  boardData: KanbanBoardData,
  parentCardId: string,
) {
  return boardData.cards.filter((card) => card.parentCardId === parentCardId)
}

function getKanbanCardChildCountsInternal(
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

function validateKanbanParentCardLink(
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

  if (
    typeof value.id !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.description !== 'string' ||
    typeof value.createdAt !== 'number' ||
    typeof value.updatedAt !== 'number' ||
    !isKanbanColumnId(value.columnId)
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
    columnId: value.columnId,
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

export function createKanbanCard(
  input: KanbanCreateCardInput,
  id: string,
  now = Date.now(),
): KanbanCard {
  const trimmedTitle = input.title.trim()
  if (!trimmedTitle) {
    throw new Error('Task title is required.')
  }

  const columnId =
    input.columnId === undefined
      ? DEFAULT_COLUMN_ID
      : assertKanbanColumnId(input.columnId)

  return {
    acceptanceCriteria: normalizeAcceptanceCriteria(
      input.acceptanceCriteria,
      id,
    ),
    assignee: normalizeOptionalText(input.assignee),
    columnId,
    createdAt: now,
    description: input.description?.trim() ?? '',
    id,
    issueType: isKanbanIssueType(input.issueType)
      ? input.issueType
      : DEFAULT_ISSUE_TYPE,
    labels: normalizeLabels(input.labels),
    parentCardId: normalizeParentCardId(input.parentCardId),
    position:
      typeof input.position === 'number' && Number.isFinite(input.position)
        ? input.position
        : now,
    priority: isKanbanPriority(input.priority)
      ? input.priority
      : DEFAULT_PRIORITY,
    revision: 1,
    sourceMessageId: input.sourceMessageId?.trim() || undefined,
    title: trimmedTitle,
    updatedAt: now,
  }
}

export function getKanbanColumnCounts(
  boardData: KanbanBoardData,
): Record<KanbanColumnId, number> {
  const counts = Object.fromEntries(
    KANBAN_COLUMN_IDS.map((columnId) => [columnId, 0]),
  ) as Record<KanbanColumnId, number>

  for (const card of boardData.cards) {
    counts[card.columnId] += 1
  }

  return counts
}

export function getKanbanCardChildSummaries(
  boardData: KanbanBoardData,
  parentCardId: string,
): KanbanCardSummary[] {
  return getKanbanCardChildrenInternal(boardData, parentCardId)
    .sort(
      (left, right) =>
        left.position - right.position || left.createdAt - right.createdAt,
    )
    .map((card) => ({
      childCount: getKanbanCardChildCountsInternal(boardData, card.id)
        .childCount,
      columnId: card.columnId,
      doneChildCount: getKanbanCardChildCountsInternal(boardData, card.id)
        .doneChildCount,
      id: card.id,
      issueType: card.issueType,
      labels: card.labels,
      parentCardId: card.parentCardId,
      priority: card.priority,
      title: card.title,
      updatedAt: card.updatedAt,
    }))
}

export function getKanbanCardDetails(
  boardData: KanbanBoardData,
  input: KanbanReadCardInput,
): KanbanCardDetails | null {
  const card = readKanbanCard(boardData, input)
  if (!card) {
    return null
  }

  const { childCount, doneChildCount } = getKanbanCardChildCountsInternal(
    boardData,
    card.id,
  )

  return {
    card,
    childCount,
    children: getKanbanCardChildSummaries(boardData, card.id),
    doneChildCount,
  }
}

export function readKanbanColumn(
  boardData: KanbanBoardData,
  columns: readonly KanbanColumnDefinition[],
  input: KanbanColumnReadInput,
): KanbanColumnReadResult {
  const columnId = assertKanbanColumnId(input.columnId)
  const column = columns.find((currentColumn) => currentColumn.id === columnId)
  if (!column) {
    throw new Error(`Kanban column is not configured: ${columnId}`)
  }

  const boundedLimit = Math.min(
    Math.max(Math.floor(input.limit ?? DEFAULT_READ_LIMIT), 1),
    MAX_READ_LIMIT,
  )
  const startIndex = input.cursor ? Number.parseInt(input.cursor, 10) : 0
  const safeStartIndex =
    Number.isFinite(startIndex) && startIndex > 0 ? startIndex : 0
  const matchingCards = boardData.cards
    .filter((card) => card.columnId === columnId)
    .sort(
      (left, right) =>
        left.position - right.position || left.createdAt - right.createdAt,
    )
  const page = matchingCards.slice(
    safeStartIndex,
    safeStartIndex + boundedLimit,
  )
  const nextIndex = safeStartIndex + page.length

  return {
    cards: page.map((card) => {
      const { childCount, doneChildCount } = getKanbanCardChildCountsInternal(
        boardData,
        card.id,
      )
      return {
        childCount,
        columnId: card.columnId,
        doneChildCount,
        id: card.id,
        issueType: card.issueType,
        labels: card.labels,
        parentCardId: card.parentCardId,
        priority: card.priority,
        title: card.title,
        updatedAt: card.updatedAt,
      }
    }),
    column: {
      count: matchingCards.length,
      id: column.id,
      title: column.title,
    },
    ...(input.includeCounts
      ? { counts: getKanbanColumnCounts(boardData) }
      : {}),
    nextCursor: nextIndex < matchingCards.length ? String(nextIndex) : null,
  }
}

export function readKanbanCard(
  boardData: KanbanBoardData,
  input: KanbanReadCardInput,
): KanbanCard | null {
  const normalizedCardId = input.cardId.trim()
  if (!normalizedCardId) {
    throw new Error('cardId is required.')
  }

  return getKanbanCardById(boardData, normalizedCardId)
}

export function addKanbanCard(
  boardData: KanbanBoardData,
  card: KanbanCard,
): KanbanBoardData {
  if (boardData.cards.some((currentCard) => currentCard.id === card.id)) {
    throw new Error(`Task already exists: ${card.id}`)
  }

  if (card.parentCardId !== undefined) {
    const parentCard = getKanbanCardById(boardData, card.parentCardId)
    if (!parentCard) {
      throw new Error(`Parent task not found: ${card.parentCardId}`)
    }

    if (!isTopLevelKanbanCard(parentCard)) {
      throw new Error('Parent task must be a top-level task.')
    }
  }

  return {
    cards: [...boardData.cards, card],
    revision: boardData.revision,
  }
}

export function updateKanbanCardContent(
  boardData: KanbanBoardData,
  input: KanbanUpdateCardContentInput,
  now = Date.now(),
): KanbanBoardData {
  const normalizedCardId = input.cardId.trim()
  if (!normalizedCardId) {
    throw new Error('cardId is required.')
  }

  if (input.title !== undefined && input.title.trim().length === 0) {
    throw new Error('Task title cannot be blank.')
  }

  const currentCard = getKanbanCardById(boardData, normalizedCardId)
  if (!currentCard) {
    throw new Error(`Task not found: ${normalizedCardId}`)
  }

  let nextParentCardId = currentCard.parentCardId
  if (input.parentCardId !== undefined) {
    if (input.parentCardId === null) {
      nextParentCardId = undefined
    } else {
      if (getKanbanCardChildrenInternal(boardData, currentCard.id).length > 0) {
        throw new Error('A task with subtasks cannot become a subtask.')
      }

      nextParentCardId = validateKanbanParentCardLink(
        boardData,
        input.parentCardId,
        currentCard.id,
      )
    }
  }

  let didUpdate = false
  const cards = boardData.cards.map((card) => {
    if (card.id !== normalizedCardId) {
      return card
    }

    didUpdate = true
    return {
      ...card,
      ...(input.acceptanceCriteria !== undefined
        ? {
            acceptanceCriteria: normalizeAcceptanceCriteria(
              input.acceptanceCriteria,
              card.id,
            ),
          }
        : {}),
      ...(input.assignee !== undefined
        ? { assignee: normalizeOptionalText(input.assignee) }
        : {}),
      ...(input.description !== undefined
        ? { description: input.description.trim() }
        : {}),
      ...(input.issueType !== undefined
        ? {
            issueType: isKanbanIssueType(input.issueType)
              ? input.issueType
              : card.issueType,
          }
        : {}),
      ...(input.labels !== undefined
        ? { labels: normalizeLabels(input.labels) }
        : {}),
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.parentCardId !== undefined
        ? { parentCardId: nextParentCardId }
        : {}),
      ...(input.priority !== undefined
        ? {
            priority: isKanbanPriority(input.priority)
              ? input.priority
              : card.priority,
          }
        : {}),
      revision: card.revision + 1,
      updatedAt: now,
    }
  })

  if (!didUpdate) {
    throw new Error(`Task not found: ${normalizedCardId}`)
  }

  return { cards, revision: boardData.revision }
}

export function updateKanbanCard(
  boardData: KanbanBoardData,
  input: KanbanUpdateCardInput,
  now = Date.now(),
): KanbanBoardData {
  const nextBoardData = updateKanbanCardContent(
    boardData,
    {
      cardId: input.cardId,
      acceptanceCriteria: input.acceptanceCriteria,
      assignee: input.assignee,
      description: input.description,
      issueType: input.issueType,
      labels: input.labels,
      parentCardId: input.parentCardId,
      priority: input.priority,
      title: input.title,
    },
    now,
  )

  return moveKanbanCard(
    nextBoardData,
    { cardId: input.cardId, targetColumnId: input.columnId },
    now,
  )
}

export function moveKanbanCard(
  boardData: KanbanBoardData,
  input: KanbanMoveInput,
  now = Date.now(),
): KanbanBoardData {
  const normalizedCardId = input.cardId.trim()
  if (!normalizedCardId) {
    throw new Error('cardId is required.')
  }

  const targetColumnId = assertKanbanColumnId(
    input.targetColumnId,
    'targetColumnId',
  )
  const currentCard = getKanbanCardById(boardData, normalizedCardId)
  if (!currentCard) {
    throw new Error(`Task not found: ${normalizedCardId}`)
  }

  if (targetColumnId === 'done' && currentCard.parentCardId === undefined) {
    const children = getKanbanCardChildrenInternal(boardData, currentCard.id)
    const incompleteChildCount = children.filter(
      (child) => child.columnId !== 'done',
    ).length
    if (incompleteChildCount > 0) {
      throw new Error(
        'A parent task cannot be moved to done until all subtasks are done.',
      )
    }
  }

  if (targetColumnId === 'done') {
    const incompleteCriterionCount = currentCard.acceptanceCriteria.filter(
      (criterion) => !criterion.completed,
    ).length
    if (incompleteCriterionCount > 0) {
      throw new Error(
        'A task cannot be moved to done until all acceptance criteria are complete.',
      )
    }
  }

  let didUpdate = false
  const cards = boardData.cards.map((card) => {
    if (card.id !== normalizedCardId) {
      return card
    }

    didUpdate = true
    if (card.columnId === targetColumnId) {
      return card
    }

    return {
      ...card,
      columnId: targetColumnId,
      revision: card.revision + 1,
      updatedAt: now,
    }
  })

  if (!didUpdate) {
    throw new Error(`Task not found: ${normalizedCardId}`)
  }

  return { cards, revision: boardData.revision }
}

export function reorderKanbanCard(
  boardData: KanbanBoardData,
  input: KanbanReorderInput,
  now = Date.now(),
): KanbanBoardData {
  const movedBoardData = moveKanbanCard(
    boardData,
    {
      cardId: input.cardId,
      targetColumnId: input.targetColumnId,
    },
    now,
  )
  const normalizedCardId = input.cardId.trim()
  const targetCards = movedBoardData.cards
    .filter(
      (card) =>
        card.columnId === input.targetColumnId && card.id !== normalizedCardId,
    )
    .sort(
      (left, right) =>
        left.position - right.position || left.createdAt - right.createdAt,
    )
  const boundedTargetIndex = Math.min(
    Math.max(Math.floor(input.targetIndex), 0),
    targetCards.length,
  )
  const previousCard = targetCards[boundedTargetIndex - 1]
  const nextCard = targetCards[boundedTargetIndex]
  const nextPosition =
    previousCard && nextCard
      ? (previousCard.position + nextCard.position) / 2
      : previousCard
        ? previousCard.position + 1024
        : nextCard
          ? nextCard.position - 1024
          : now

  return {
    cards: movedBoardData.cards.map((card) =>
      card.id === normalizedCardId && card.position !== nextPosition
        ? {
            ...card,
            position: nextPosition,
            revision: card.revision + 1,
            updatedAt: now,
          }
        : card,
    ),
    revision: boardData.revision,
  }
}

export function deleteKanbanCard(
  boardData: KanbanBoardData,
  input: KanbanDeleteCardInput,
): KanbanBoardData {
  const normalizedCardId = input.cardId.trim()
  if (!normalizedCardId) {
    throw new Error('cardId is required.')
  }

  const currentCard = getKanbanCardById(boardData, normalizedCardId)
  if (!currentCard) {
    throw new Error(`Task not found: ${normalizedCardId}`)
  }

  const children = getKanbanCardChildrenInternal(boardData, normalizedCardId)
  if (children.length > 0 && input.deleteSubtasks !== true) {
    throw new Error(
      'This task has subtasks. Confirm that its subtasks should be deleted too.',
    )
  }

  const deletedIds = new Set([
    normalizedCardId,
    ...(input.deleteSubtasks ? children.map((child) => child.id) : []),
  ])
  return {
    cards: boardData.cards.filter((card) => !deletedIds.has(card.id)),
    revision: boardData.revision,
  }
}

export function clearDoneKanbanCards(
  boardData: KanbanBoardData,
): KanbanBoardData {
  const completedCardIds = new Set(
    boardData.cards
      .filter((card) => card.columnId === 'done')
      .map((card) => card.id),
  )

  return {
    cards: boardData.cards
      .filter((card) => card.columnId !== 'done')
      .map((card) =>
        card.parentCardId && completedCardIds.has(card.parentCardId)
          ? {
              ...card,
              parentCardId: undefined,
              revision: card.revision + 1,
            }
          : card,
      ),
    revision: boardData.revision,
  }
}
