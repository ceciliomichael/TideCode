import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Message } from '../../types/chat'
import {
  createCardTitleFromMessage,
  getKanbanSourceMessages,
} from './kanbanMessageSources'
import {
  presentKanbanError,
  type KanbanErrorAction,
  type KanbanUserFacingError,
} from './kanbanErrorPresentation'
import { loadLegacyKanbanBoardData } from './kanbanStorage'
import type {
  KanbanBoardData,
  KanbanCard,
  KanbanColumnId,
  KanbanCreateCardInput,
  KanbanCreateTaskInput,
  KanbanCreateTaskResult,
  KanbanDeleteCardInput,
  KanbanMoveInput,
  KanbanReorderInput,
  KanbanUpdateCardInput,
} from './kanbanTypes'

interface UseKanbanBoardStateInput {
  workspacePath: string | null
  messages: readonly Message[]
}

interface UseKanbanBoardStateResult {
  addCard: (input: KanbanCreateCardInput) => Promise<KanbanCard | null>
  addCardFromMessage: (messageId: string) => Promise<KanbanCard | null>
  addCardFromMessageToColumn: (
    messageId: string,
    columnId: KanbanColumnId,
  ) => Promise<KanbanCard | null>
  cards: readonly KanbanCard[]
  clearCompletedCards: () => Promise<void>
  createTask: (
    input: KanbanCreateTaskInput,
  ) => Promise<KanbanCreateTaskResult | null>
  deleteCard: (input: KanbanDeleteCardInput) => Promise<boolean>
  dismissError: () => void
  error: KanbanUserFacingError | null
  isBusy: boolean
  isLoading: boolean
  moveCard: (input: KanbanMoveInput) => Promise<KanbanCard | null>
  reorderCard: (input: KanbanReorderInput) => Promise<KanbanCard | null>
  sourceMessages: ReturnType<typeof getKanbanSourceMessages>
  updateCard: (input: KanbanUpdateCardInput) => Promise<KanbanCard | null>
}

const EMPTY_BOARD_DATA: KanbanBoardData = {
  cards: [],
  revision: 0,
}

function hasWorkspacePath(
  workspacePath: string | null,
): workspacePath is string {
  return workspacePath !== null && workspacePath.trim().length > 0
}

export function useKanbanBoardState({
  workspacePath,
  messages,
}: UseKanbanBoardStateInput): UseKanbanBoardStateResult {
  const [boardData, setBoardData] = useState<KanbanBoardData>(EMPTY_BOARD_DATA)
  const [error, setError] = useState<KanbanUserFacingError | null>(null)
  const [pendingMutationCount, setPendingMutationCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const sourceMessages = useMemo(
    () => getKanbanSourceMessages(messages),
    [messages],
  )

  const refreshBoardData = useCallback(async () => {
    if (!hasWorkspacePath(workspacePath)) {
      setBoardData(EMPTY_BOARD_DATA)
      return
    }

    const nextBoardData = await window.tidecodeKanban.getBoardData({
      workspacePath,
    })
    setBoardData(nextBoardData)
  }, [workspacePath])

  const refreshBoardDataSafely = useCallback(async () => {
    try {
      await refreshBoardData()
    } catch (refreshError) {
      console.error('Failed to refresh kanban board', refreshError)
      setError(presentKanbanError('refresh', refreshError))
    }
  }, [refreshBoardData])

  const runMutation = useCallback(
    async <Result>(
      action: KanbanErrorAction,
      mutation: () => Promise<Result>,
      relatedCardId?: string,
    ): Promise<Result | null> => {
      setPendingMutationCount((count) => count + 1)
      setError(null)
      try {
        return await mutation()
      } catch (mutationError) {
        console.error(`Failed to ${action} kanban board`, mutationError)
        setError(presentKanbanError(action, mutationError, relatedCardId))
        return null
      } finally {
        setPendingMutationCount((count) => Math.max(0, count - 1))
      }
    },
    [],
  )

  useEffect(() => {
    let isActive = true
    setIsLoading(true)

    async function loadBoardData() {
      if (!hasWorkspacePath(workspacePath)) {
        setBoardData(EMPTY_BOARD_DATA)
        setIsLoading(false)
        return
      }

      try {
        const nextBoardData = await window.tidecodeKanban.getBoardData({
          workspacePath,
        })
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

        const importedBoardData = await window.tidecodeKanban.importBoardData(
          {
            cards: legacyBoardData.cards,
            revision: legacyBoardData.revision,
            workspacePath,
          },
        )
        if (isActive) {
          setBoardData(importedBoardData)
        }
      } catch (error) {
        if (isActive) {
          console.error('Failed to load kanban board', error)
          setError(presentKanbanError('load', error))
          setBoardData(EMPTY_BOARD_DATA)
        }
      } finally {
        if (isActive) {
          setIsLoading(false)
        }
      }
    }

    void loadBoardData()

    return () => {
      isActive = false
    }
  }, [workspacePath])

  useEffect(() => {
    if (!hasWorkspacePath(workspacePath)) {
      return
    }

    const normalizedWorkspacePath = workspacePath.trim().toLocaleLowerCase()
    const unsubscribeKanbanChanges = window.tidecodeKanban.onBoardChange(
      (event) => {
        if (
          event.workspaceRootPath.trim().toLocaleLowerCase() !==
          normalizedWorkspacePath
        ) {
          return
        }

        void refreshBoardDataSafely()
      },
    )

    return unsubscribeKanbanChanges
  }, [refreshBoardDataSafely, workspacePath])

  const addCard = useCallback(
    async (input: KanbanCreateCardInput) => {
      if (!hasWorkspacePath(workspacePath) || input.title.trim().length === 0) {
        return null
      }

      const result = await runMutation('create', () =>
        window.tidecodeKanban.createCard({
          ...input,
          title: input.title.trim(),
          workspacePath,
        }),
      )
      if (result) {
        await refreshBoardDataSafely()
      }
      return result
    },
    [refreshBoardDataSafely, runMutation, workspacePath],
  )

  const createTask = useCallback(
    async (input: KanbanCreateTaskInput) => {
      if (!hasWorkspacePath(workspacePath) || input.title.trim().length === 0) {
        return null
      }

      const result = await runMutation('create', () =>
        window.tidecodeKanban.createTask({
          ...input,
          title: input.title.trim(),
          workspacePath,
        }),
      )
      if (result) {
        await refreshBoardDataSafely()
      }
      return result
    },
    [refreshBoardDataSafely, runMutation, workspacePath],
  )

  const addCardFromMessage = useCallback(
    async (messageId: string) => {
      const sourceMessage = messages.find((message) => message.id === messageId)
      if (!sourceMessage) {
        return null
      }

      return addCard({
        description: sourceMessage.content.trim(),
        sourceMessageId: sourceMessage.id,
        title: createCardTitleFromMessage(sourceMessage),
      })
    },
    [addCard, messages],
  )

  const addCardFromMessageToColumn = useCallback(
    async (messageId: string, columnId: KanbanColumnId) => {
      const sourceMessage = messages.find((message) => message.id === messageId)
      if (!sourceMessage) {
        return null
      }

      return addCard({
        columnId,
        description: sourceMessage.content.trim(),
        sourceMessageId: sourceMessage.id,
        title: createCardTitleFromMessage(sourceMessage),
      })
    },
    [addCard, messages],
  )

  const moveCard = useCallback(
    async ({ cardId, targetColumnId }: KanbanMoveInput) => {
      if (!hasWorkspacePath(workspacePath)) {
        return null
      }

      const result = await runMutation(
        'move',
        () =>
          window.tidecodeKanban.moveCard({
            cardId,
            targetColumnId,
            workspacePath,
          }),
        cardId,
      )
      if (result) {
        await refreshBoardDataSafely()
      }
      return result
    },
    [refreshBoardDataSafely, runMutation, workspacePath],
  )

  const reorderCard = useCallback(
    async ({ cardId, targetColumnId, targetIndex }: KanbanReorderInput) => {
      if (!hasWorkspacePath(workspacePath)) {
        return null
      }

      const result = await runMutation(
        'reorder',
        () =>
          window.tidecodeKanban.reorderCard({
            cardId,
            targetColumnId,
            targetIndex,
            workspacePath,
          }),
        cardId,
      )
      if (result) {
        await refreshBoardDataSafely()
      }
      return result
    },
    [refreshBoardDataSafely, runMutation, workspacePath],
  )

  const deleteCard = useCallback(
    async (input: KanbanDeleteCardInput) => {
      if (!hasWorkspacePath(workspacePath)) {
        return false
      }

      const result = await runMutation(
        'delete',
        () => window.tidecodeKanban.deleteCard({ ...input, workspacePath }),
        input.cardId,
      )
      if (result) {
        await refreshBoardDataSafely()
        return true
      }
      return false
    },
    [refreshBoardDataSafely, runMutation, workspacePath],
  )

  const updateCard = useCallback(
    async (input: KanbanUpdateCardInput) => {
      const trimmedTitle = input.title.trim()
      if (!hasWorkspacePath(workspacePath) || !trimmedTitle) {
        return null
      }

      const result = await runMutation(
        'save',
        () =>
          window.tidecodeKanban.updateCard({
            ...input,
            title: trimmedTitle,
            workspacePath,
          }),
        input.cardId,
      )
      if (result) {
        await refreshBoardDataSafely()
      }
      return result
    },
    [refreshBoardDataSafely, runMutation, workspacePath],
  )

  const clearCompletedCards = useCallback(async () => {
    if (!hasWorkspacePath(workspacePath)) {
      return
    }

    const result = await runMutation('clear', () =>
      window.tidecodeKanban.clearCompletedCards({ workspacePath }),
    )
    if (result) {
      await refreshBoardDataSafely()
    }
  }, [refreshBoardDataSafely, runMutation, workspacePath])

  return {
    addCard,
    addCardFromMessage,
    addCardFromMessageToColumn,
    cards: boardData.cards,
    clearCompletedCards,
    createTask,
    deleteCard,
    dismissError: () => setError(null),
    error,
    isBusy: pendingMutationCount > 0,
    isLoading,
    moveCard,
    reorderCard,
    sourceMessages,
    updateCard,
  }
}
