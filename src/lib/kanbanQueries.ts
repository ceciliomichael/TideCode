import {
  KANBAN_COLUMN_IDS,
  type KanbanBoardData,
  type KanbanCard,
  type KanbanCardDetails,
  type KanbanCardSummary,
  type KanbanColumnDefinition,
  type KanbanColumnId,
  type KanbanColumnReadInput,
  type KanbanColumnReadResult,
  type KanbanReadCardInput,
} from './kanbanContracts'
import {
  DEFAULT_READ_LIMIT,
  MAX_READ_LIMIT,
  assertKanbanColumnId,
  getKanbanCardById,
  getKanbanCardChildCountsInternal,
  getKanbanCardChildrenInternal,
} from './kanbanCore'

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
