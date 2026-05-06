import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Message } from '../../types/chat'
import { createCardTitleFromMessage, getKanbanSourceMessages } from './kanbanMessageSources'
import { loadKanbanBoardData, saveKanbanBoardData } from './kanbanStorage'
import type {
  KanbanBoardData,
  KanbanCard,
  KanbanColumnId,
  KanbanDeleteCardInput,
  KanbanCreateCardInput,
  KanbanMoveInput,
  KanbanUpdateCardInput,
} from './kanbanTypes'

interface UseKanbanBoardStateInput {
  workspacePath: string | null
  messages: readonly Message[]
}

interface UseKanbanBoardStateResult {
  addCard: (input: KanbanCreateCardInput) => void
  addCardFromMessage: (messageId: string) => void
  addCardFromMessageToColumn: (messageId: string, columnId: KanbanColumnId) => void
  cards: readonly KanbanCard[]
  clearCompletedCards: () => void
  deleteCard: (input: KanbanDeleteCardInput) => void
  moveCard: (input: KanbanMoveInput) => void
  updateCard: (input: KanbanUpdateCardInput) => void
  sourceMessages: ReturnType<typeof getKanbanSourceMessages>
}

function createCardId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `kanban-card-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function createCard(input: KanbanCreateCardInput): KanbanCard {
  const now = Date.now()

  return {
    columnId: input.columnId ?? 'backlog',
    createdAt: now,
    description: input.description?.trim() ?? '',
    id: createCardId(),
    sourceMessageId: input.sourceMessageId,
    title: input.title.trim(),
    updatedAt: now,
  }
}

export function useKanbanBoardState({ workspacePath, messages }: UseKanbanBoardStateInput): UseKanbanBoardStateResult {
  const [boardData, setBoardData] = useState<KanbanBoardData>(() => loadKanbanBoardData(workspacePath))
  const sourceMessages = useMemo(() => getKanbanSourceMessages(messages), [messages])

  useEffect(() => {
    setBoardData(loadKanbanBoardData(workspacePath))
  }, [workspacePath])

  useEffect(() => {
    saveKanbanBoardData(workspacePath, boardData)
  }, [boardData, workspacePath])

  const addCard = useCallback((input: KanbanCreateCardInput) => {
    const trimmedTitle = input.title.trim()
    if (!trimmedTitle) {
      return
    }

    setBoardData((currentBoardData) => ({
      cards: [...currentBoardData.cards, createCard({ ...input, title: trimmedTitle })],
    }))
  }, [])

  const addCardFromMessage = useCallback(
    (messageId: string) => {
      const sourceMessage = messages.find((message) => message.id === messageId)
      if (!sourceMessage) {
        return
      }

      addCard({
        description: sourceMessage.content.trim(),
        sourceMessageId: sourceMessage.id,
        title: createCardTitleFromMessage(sourceMessage),
      })
    },
    [addCard, messages],
  )

  const addCardFromMessageToColumn = useCallback(
    (messageId: string, columnId: KanbanColumnId) => {
      const sourceMessage = messages.find((message) => message.id === messageId)
      if (!sourceMessage) {
        return
      }

      addCard({
        columnId,
        description: sourceMessage.content.trim(),
        sourceMessageId: sourceMessage.id,
        title: createCardTitleFromMessage(sourceMessage),
      })
    },
    [addCard, messages],
  )

  const moveCard = useCallback(({ cardId, targetColumnId }: KanbanMoveInput) => {
    setBoardData((currentBoardData) => ({
      cards: currentBoardData.cards.map((card) =>
        card.id === cardId
          ? {
              ...card,
              columnId: targetColumnId,
              updatedAt: Date.now(),
            }
          : card,
      ),
    }))
  }, [])

  const deleteCard = useCallback(({ cardId }: KanbanDeleteCardInput) => {
    setBoardData((currentBoardData) => ({
      cards: currentBoardData.cards.filter((card) => card.id !== cardId),
    }))
  }, [])

  const updateCard = useCallback(({ cardId, columnId, description, title }: KanbanUpdateCardInput) => {
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      return
    }

    setBoardData((currentBoardData) => ({
      cards: currentBoardData.cards.map((card) =>
        card.id === cardId
          ? {
              ...card,
              columnId,
              description: description.trim(),
              title: trimmedTitle,
              updatedAt: Date.now(),
            }
          : card,
      ),
    }))
  }, [])

  const clearCompletedCards = useCallback(() => {
    setBoardData((currentBoardData) => ({
      cards: currentBoardData.cards.filter((card) => card.columnId !== 'done'),
    }))
  }, [])

  return {
    addCard,
    addCardFromMessage,
    addCardFromMessageToColumn,
    cards: boardData.cards,
    clearCompletedCards,
    deleteCard,
    moveCard,
    updateCard,
    sourceMessages,
  }
}
