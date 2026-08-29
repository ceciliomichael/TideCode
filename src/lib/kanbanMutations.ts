import type {
  KanbanBoardData,
  KanbanCard,
  KanbanCreateCardInput,
  KanbanDeleteCardInput,
  KanbanMoveInput,
  KanbanReorderInput,
  KanbanUpdateCardContentInput,
  KanbanUpdateCardInput,
} from './kanbanContracts'
import {
  DEFAULT_COLUMN_ID,
  DEFAULT_ISSUE_TYPE,
  DEFAULT_PRIORITY,
  assertKanbanColumnId,
  getKanbanCardById,
  getKanbanCardChildrenInternal,
  isKanbanIssueType,
  isKanbanPriority,
  isTopLevelKanbanCard,
  normalizeAcceptanceCriteria,
  normalizeLabels,
  normalizeOptionalText,
  normalizeParentCardId,
  validateKanbanParentCardLink,
} from './kanbanCore'

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

  const shouldCompleteChildren =
    targetColumnId === 'for-review' && currentCard.parentCardId === undefined

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
    if (shouldCompleteChildren && card.parentCardId === currentCard.id) {
      if (card.columnId === 'done') {
        return card
      }
      return {
        ...card,
        columnId: 'done' as const,
        revision: card.revision + 1,
        updatedAt: now,
      }
    }

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
  const completedParentIds = new Set(
    boardData.cards
      .filter(
        (card) => card.parentCardId === undefined && card.columnId === 'done',
      )
      .map((card) => card.id),
  )

  return {
    cards: boardData.cards.filter(
      (card) =>
        !completedParentIds.has(card.id) &&
        !(card.parentCardId && completedParentIds.has(card.parentCardId)),
    ),
    revision: boardData.revision,
  }
}
