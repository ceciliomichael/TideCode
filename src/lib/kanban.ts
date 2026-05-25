export const KANBAN_COLUMN_IDS = ['backlog', 'in-progress', 'blocked', 'done'] as const

export type KanbanColumnId = (typeof KANBAN_COLUMN_IDS)[number]

export interface KanbanColumnDefinition {
  description: string
  id: KanbanColumnId
  title: string
}

export interface KanbanCreateCardInput {
  columnId?: KanbanColumnId
  description?: string
  parentCardId?: string | null
  sourceMessageId?: string
  title: string
}

export interface KanbanUpdateCardInput {
  cardId: string
  columnId: KanbanColumnId
  description: string
  parentCardId?: string | null
  title: string
}

export interface KanbanUpdateCardContentInput {
  cardId: string
  description?: string
  parentCardId?: string | null
  title?: string
}

export interface KanbanDeleteCardInput {
  cardId: string
}

export interface KanbanCard {
  columnId: KanbanColumnId
  createdAt: number
  description: string
  id: string
  parentCardId?: string
  sourceMessageId?: string
  title: string
  updatedAt: number
}

export interface KanbanBoardData {
  cards: KanbanCard[]
}

export interface KanbanCardSummary {
  childCount: number
  doneChildCount: number
  id: string
  parentCardId?: string
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

export type KanbanReadBoardRequest = KanbanWorkspaceInput & KanbanColumnReadInput
export type KanbanReadCardRequest = KanbanWorkspaceInput & KanbanReadCardInput
export type KanbanCreateCardRequest = KanbanWorkspaceInput & KanbanCreateCardInput
export type KanbanUpdateCardRequest = KanbanWorkspaceInput & KanbanUpdateCardContentInput
export type KanbanMoveCardRequest = KanbanWorkspaceInput & KanbanMoveInput
export type KanbanDeleteCardRequest = KanbanWorkspaceInput & KanbanDeleteCardInput

export interface KanbanSourceMessage<MessageValue = unknown> {
  id: string
  label: string
  message: MessageValue
}

const DEFAULT_COLUMN_ID: KanbanColumnId = 'backlog'
const DEFAULT_READ_LIMIT = 20
const MAX_READ_LIMIT = 50

export function isKanbanColumnId(value: unknown): value is KanbanColumnId {
  return typeof value === 'string' && KANBAN_COLUMN_IDS.includes(value as KanbanColumnId)
}

export function assertKanbanColumnId(value: unknown, fieldName = 'columnId'): KanbanColumnId {
  if (!isKanbanColumnId(value)) {
    throw new Error(`${fieldName} must be one of: ${KANBAN_COLUMN_IDS.join(', ')}.`)
  }

  return value
}

export function normalizeKanbanWorkspacePath(workspacePath: string | null | undefined) {
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
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function isTopLevelKanbanCard(card: KanbanCard) {
  return card.parentCardId === undefined
}

function getKanbanCardById(boardData: KanbanBoardData, cardId: string) {
  return boardData.cards.find((card) => card.id === cardId) ?? null
}

function getKanbanCardChildrenInternal(boardData: KanbanBoardData, parentCardId: string) {
  return boardData.cards.filter((card) => card.parentCardId === parentCardId)
}

function getKanbanCardChildCountsInternal(boardData: KanbanBoardData, parentCardId: string) {
  const children = getKanbanCardChildrenInternal(boardData, parentCardId)
  const doneChildCount = children.filter((card) => card.columnId === 'done').length

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
  const topLevelCardIds = new Set(cards.filter((card) => card.parentCardId === undefined).map((card) => card.id))

  return cards.map((card) => {
    const parentCardId = normalizeParentCardId(card.parentCardId)
    if (!parentCardId || parentCardId === card.id || !topLevelCardIds.has(parentCardId)) {
      return {
        ...card,
        parentCardId: undefined,
      }
    }

    return {
      ...card,
      parentCardId,
    }
  })
}

export function normalizeKanbanBoardData(boardData: KanbanBoardData): KanbanBoardData {
  return {
    cards: sanitizeKanbanBoardCards(boardData.cards),
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

  return {
    columnId: value.columnId,
    createdAt: value.createdAt,
    description: value.description,
    id: value.id,
    parentCardId: normalizeParentCardId(value.parentCardId),
    sourceMessageId: typeof value.sourceMessageId === 'string' ? value.sourceMessageId : undefined,
    title: value.title,
    updatedAt: value.updatedAt,
  }
}

export function parseKanbanBoardData(value: unknown): KanbanBoardData {
  if (!isRecord(value) || !Array.isArray(value.cards)) {
    return { cards: [] }
  }

  return normalizeKanbanBoardData({
    cards: value.cards.map(parseKanbanCard).filter((card): card is KanbanCard => card !== null),
  })
}

export function createKanbanCard(input: KanbanCreateCardInput, id: string, now = Date.now()): KanbanCard {
  const trimmedTitle = input.title.trim()
  if (!trimmedTitle) {
    throw new Error('Task title is required.')
  }

  const columnId = input.columnId === undefined ? DEFAULT_COLUMN_ID : assertKanbanColumnId(input.columnId)

  return {
    columnId,
    createdAt: now,
    description: input.description?.trim() ?? '',
    id,
    parentCardId: normalizeParentCardId(input.parentCardId),
    sourceMessageId: input.sourceMessageId?.trim() || undefined,
    title: trimmedTitle,
    updatedAt: now,
  }
}

export function getKanbanColumnCounts(boardData: KanbanBoardData): Record<KanbanColumnId, number> {
  const counts = Object.fromEntries(KANBAN_COLUMN_IDS.map((columnId) => [columnId, 0])) as Record<KanbanColumnId, number>

  for (const card of boardData.cards) {
    counts[card.columnId] += 1
  }

  return counts
}

export function getKanbanCardChildSummaries(boardData: KanbanBoardData, parentCardId: string): KanbanCardSummary[] {
  return getKanbanCardChildrenInternal(boardData, parentCardId).map((card) => ({
    childCount: getKanbanCardChildCountsInternal(boardData, card.id).childCount,
    doneChildCount: getKanbanCardChildCountsInternal(boardData, card.id).doneChildCount,
    id: card.id,
    parentCardId: card.parentCardId,
    title: card.title,
    updatedAt: card.updatedAt,
  }))
}

export function getKanbanCardDetails(boardData: KanbanBoardData, input: KanbanReadCardInput): KanbanCardDetails | null {
  const card = readKanbanCard(boardData, input)
  if (!card) {
    return null
  }

  const { childCount, doneChildCount } = getKanbanCardChildCountsInternal(boardData, card.id)

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

  const boundedLimit = Math.min(Math.max(Math.floor(input.limit ?? DEFAULT_READ_LIMIT), 1), MAX_READ_LIMIT)
  const startIndex = input.cursor ? Number.parseInt(input.cursor, 10) : 0
  const safeStartIndex = Number.isFinite(startIndex) && startIndex > 0 ? startIndex : 0
  const matchingCards = boardData.cards.filter((card) => card.columnId === columnId)
  const page = matchingCards.slice(safeStartIndex, safeStartIndex + boundedLimit)
  const nextIndex = safeStartIndex + page.length

  return {
    cards: page.map((card) => {
      const { childCount, doneChildCount } = getKanbanCardChildCountsInternal(boardData, card.id)
      return {
        childCount,
        doneChildCount,
        id: card.id,
        parentCardId: card.parentCardId,
        title: card.title,
        updatedAt: card.updatedAt,
      }
    }),
    column: {
      count: matchingCards.length,
      id: column.id,
      title: column.title,
    },
    ...(input.includeCounts ? { counts: getKanbanColumnCounts(boardData) } : {}),
    nextCursor: nextIndex < matchingCards.length ? String(nextIndex) : null,
  }
}

export function readKanbanCard(boardData: KanbanBoardData, input: KanbanReadCardInput): KanbanCard | null {
  const normalizedCardId = input.cardId.trim()
  if (!normalizedCardId) {
    throw new Error('cardId is required.')
  }

  return getKanbanCardById(boardData, normalizedCardId)
}

export function addKanbanCard(boardData: KanbanBoardData, card: KanbanCard): KanbanBoardData {
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

      nextParentCardId = validateKanbanParentCardLink(boardData, input.parentCardId, currentCard.id)
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
      ...(input.description !== undefined ? { description: input.description.trim() } : {}),
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.parentCardId !== undefined ? { parentCardId: nextParentCardId } : {}),
      updatedAt: now,
    }
  })

  if (!didUpdate) {
    throw new Error(`Task not found: ${normalizedCardId}`)
  }

  return { cards }
}

export function updateKanbanCard(boardData: KanbanBoardData, input: KanbanUpdateCardInput, now = Date.now()): KanbanBoardData {
  const nextBoardData = updateKanbanCardContent(
    boardData,
    {
      cardId: input.cardId,
      description: input.description,
      parentCardId: input.parentCardId,
      title: input.title,
    },
    now,
  )

  return moveKanbanCard(nextBoardData, { cardId: input.cardId, targetColumnId: input.columnId }, now)
}

export function moveKanbanCard(boardData: KanbanBoardData, input: KanbanMoveInput, now = Date.now()): KanbanBoardData {
  const normalizedCardId = input.cardId.trim()
  if (!normalizedCardId) {
    throw new Error('cardId is required.')
  }

  const targetColumnId = assertKanbanColumnId(input.targetColumnId, 'targetColumnId')
  const currentCard = getKanbanCardById(boardData, normalizedCardId)
  if (!currentCard) {
    throw new Error(`Task not found: ${normalizedCardId}`)
  }

  if (targetColumnId === 'done' && currentCard.parentCardId === undefined) {
    const children = getKanbanCardChildrenInternal(boardData, currentCard.id)
    const incompleteChildCount = children.filter((child) => child.columnId !== 'done').length
    if (incompleteChildCount > 0) {
      throw new Error('A parent task cannot be moved to done until all subtasks are done.')
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
      updatedAt: now,
    }
  })

  if (!didUpdate) {
    throw new Error(`Task not found: ${normalizedCardId}`)
  }

  return { cards }
}

export function deleteKanbanCard(boardData: KanbanBoardData, input: KanbanDeleteCardInput): KanbanBoardData {
  const normalizedCardId = input.cardId.trim()
  if (!normalizedCardId) {
    throw new Error('cardId is required.')
  }

  return {
    cards: boardData.cards.filter((card) => card.id !== normalizedCardId),
  }
}

export function clearDoneKanbanCards(boardData: KanbanBoardData): KanbanBoardData {
  return {
    cards: boardData.cards.filter((card) => card.columnId !== 'done'),
  }
}
