import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Message } from '../../types/chat'
import { createCardTitleFromMessage, getKanbanSourceMessages } from './kanbanMessageSources'
import { loadLegacyKanbanBoardData } from './kanbanStorage'
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

function hasWorkspacePath(workspacePath: string | null): workspacePath is string {
  return workspacePath !== null && workspacePath.trim().length > 0
}

function logKanbanSyncError(action: string, error: unknown) {
  console.error(`Failed to ${action} kanban board`, error)
}

export function useKanbanBoardState({ workspacePath, messages }: UseKanbanBoardStateInput): UseKanbanBoardStateResult {
  const [boardData, setBoardData] = useState<KanbanBoardData>({ cards: [] })
  const sourceMessages = useMemo(() => getKanbanSourceMessages(messages), [messages])

  const refreshBoardData = useCallback(async () => {
    if (!hasWorkspacePath(workspacePath)) {
      setBoardData({ cards: [] })
      return
    }

    const nextBoardData = await window.echosphereKanban.getBoardData({ workspacePath })
    setBoardData(nextBoardData)
  }, [workspacePath])

  useEffect(() => {
    let isActive = true

    async function loadBoardData() {
      if (!hasWorkspacePath(workspacePath)) {
        setBoardData({ cards: [] })
        return
      }

      try {
        const nextBoardData = await window.echosphereKanban.getBoardData({ workspacePath })
        if (!isActive) {
          return
        }

        if (nextBoardData.cards.length > 0) {
          setBoardData(nextBoardData)
          return
        }

        const legacyBoardData = loadLegacyKanbanBoardData(workspacePath)
        if (legacyBoardData.cards.length === 0) {
          setBoardData(nextBoardData)
          return
        }

        const importedBoardData = await window.echosphereKanban.importBoardData({
          cards: legacyBoardData.cards,
          workspacePath,
        })
        if (isActive) {
          setBoardData(importedBoardData)
        }
      } catch (error) {
        if (isActive) {
          logKanbanSyncError('load', error)
          setBoardData({ cards: [] })
        }
      }
    }

    void loadBoardData()

    return () => {
      isActive = false
    }
  }, [workspacePath])

  const addCard = useCallback(
    (input: KanbanCreateCardInput) => {
      if (!hasWorkspacePath(workspacePath) || input.title.trim().length === 0) {
        return
      }

      void window.echosphereKanban
        .createCard({
          ...input,
          title: input.title.trim(),
          workspacePath,
        })
        .then(refreshBoardData)
        .catch((error) => logKanbanSyncError('create task on', error))
    },
    [refreshBoardData, workspacePath],
  )

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

  const moveCard = useCallback(
    ({ cardId, targetColumnId }: KanbanMoveInput) => {
      if (!hasWorkspacePath(workspacePath)) {
        return
      }

      void window.echosphereKanban
        .moveCard({ cardId, targetColumnId, workspacePath })
        .then(refreshBoardData)
        .catch((error) => logKanbanSyncError('move task on', error))
    },
    [refreshBoardData, workspacePath],
  )

  const deleteCard = useCallback(
    ({ cardId }: KanbanDeleteCardInput) => {
      if (!hasWorkspacePath(workspacePath)) {
        return
      }

      void window.echosphereKanban
        .deleteCard({ cardId, workspacePath })
        .then(setBoardData)
        .catch((error) => logKanbanSyncError('delete task from', error))
    },
    [workspacePath],
  )

  const updateCard = useCallback(
    ({ cardId, columnId, description, title }: KanbanUpdateCardInput) => {
      const trimmedTitle = title.trim()
      if (!hasWorkspacePath(workspacePath) || !trimmedTitle) {
        return
      }

      void window.echosphereKanban
        .updateCard({
          cardId,
          columnId,
          description,
          title: trimmedTitle,
          workspacePath,
        })
        .then(refreshBoardData)
        .catch((error) => logKanbanSyncError('update task on', error))
    },
    [refreshBoardData, workspacePath],
  )

  const clearCompletedCards = useCallback(() => {
    if (!hasWorkspacePath(workspacePath)) {
      return
    }

    void window.echosphereKanban
      .clearCompletedCards({ workspacePath })
      .then(setBoardData)
      .catch((error) => logKanbanSyncError('clear completed tasks from', error))
  }, [workspacePath])

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
