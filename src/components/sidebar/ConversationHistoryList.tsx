import { useEffect, useRef, useState, type DragEvent } from 'react'
import type {
  ConversationGroupPreview,
  FolderReorderPosition,
  ReorderConversationFolderInput,
} from '../../types/chat'
import { FolderOpen } from 'lucide-react'
import { ConversationFolderSection } from './ConversationFolderSection'

interface ConversationHistoryListProps {
  conversationGroups: ConversationGroupPreview[]
  onCreateConversation: (folderId?: string | null) => void
  onDeleteConversation: (conversationId: string) => void
  onDeleteFolder: (folderId: string) => Promise<void>
  onReorderFolder: (input: ReorderConversationFolderInput) => Promise<void>
  onRenameFolder: (folderId: string, name: string) => Promise<void>
  onSelectConversation: (conversationId: string) => void
  onSelectFolder: (folderId: string | null) => void
}

const COLLAPSED_FOLDER_STATE_STORAGE_KEY = 'echosphere:sidebar-collapsed-folders'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readCollapsedFolderState(): Record<string, boolean> {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const raw = window.localStorage.getItem(COLLAPSED_FOLDER_STATE_STORAGE_KEY)
    if (!raw) {
      return {}
    }

    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) {
      return {}
    }

    const nextState: Record<string, boolean> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'boolean') {
        nextState[key] = value
      }
    }

    return nextState
  } catch {
    return {}
  }
}

function getDropPosition(event: DragEvent<HTMLElement>): FolderReorderPosition {
  const rect = event.currentTarget.getBoundingClientRect()
  return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

export function ConversationHistoryList({
  conversationGroups,
  onCreateConversation,
  onSelectConversation,
  onDeleteConversation,
  onDeleteFolder,
  onReorderFolder,
  onRenameFolder,
  onSelectFolder,
}: ConversationHistoryListProps) {
  const [collapsedFolderState, setCollapsedFolderState] = useState<Record<string, boolean>>(() =>
    readCollapsedFolderState(),
  )
  const [draggedFolderId, setDraggedFolderId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ folderId: string; position: FolderReorderPosition } | null>(null)
  const reorderCommitPendingRef = useRef(false)
  const hasAnyConversations = conversationGroups.some((group) => group.conversations.length > 0)

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    try {
      window.localStorage.setItem(COLLAPSED_FOLDER_STATE_STORAGE_KEY, JSON.stringify(collapsedFolderState))
    } catch {
      // Ignore storage write failures.
    }
  }, [collapsedFolderState])

  function handleToggleFolder(folderId: string | null) {
    const stateKey = folderId ?? 'unfiled'
    setCollapsedFolderState((currentValue) => ({
      ...currentValue,
      [stateKey]: !currentValue[stateKey],
    }))
  }

  function resetDragState() {
    setDraggedFolderId(null)
    setDropTarget(null)
    reorderCommitPendingRef.current = false
  }

  function commitFolderReorder(input: ReorderConversationFolderInput) {
    if (reorderCommitPendingRef.current) {
      return
    }

    reorderCommitPendingRef.current = true
    void onReorderFolder(input).finally(() => {
      resetDragState()
    })
  }

  function handleDragStart(event: DragEvent<HTMLElement>, folderId: string) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', folderId)
    reorderCommitPendingRef.current = false
    setDropTarget(null)

    // Postpone setting the dragged folder ID to the next tick to prevent
    // HTML5 drag from immediately aborting due to synchronous DOM collapse/layout changes.
    setTimeout(() => {
      setDraggedFolderId(folderId)
    }, 0)
  }

  function handleDragEnd() {
    if (!draggedFolderId || !dropTarget || draggedFolderId === dropTarget.folderId) {
      resetDragState()
      return
    }

    commitFolderReorder({
      folderId: draggedFolderId,
      targetFolderId: dropTarget.folderId,
      position: dropTarget.position,
    })
  }

  function handleDragOver(event: DragEvent<HTMLElement>, targetFolderId: string) {
    const sourceFolderId = draggedFolderId ?? event.dataTransfer.getData('text/plain')
    if (!sourceFolderId || sourceFolderId === targetFolderId) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const position = getDropPosition(event)
    setDropTarget((currentValue) => {
      if (currentValue?.folderId === targetFolderId && currentValue.position === position) {
        return currentValue
      }

      return {
        folderId: targetFolderId,
        position,
      }
    })
  }

  function handleDrop(event: DragEvent<HTMLElement>, targetFolderId: string) {
    event.preventDefault()

    const sourceFolderId = draggedFolderId ?? event.dataTransfer.getData('text/plain')
    if (!sourceFolderId || sourceFolderId === targetFolderId) {
      resetDragState()
      return
    }

    const position =
      dropTarget?.folderId === targetFolderId ? dropTarget.position : getDropPosition(event)

    commitFolderReorder({
      folderId: sourceFolderId,
      targetFolderId,
      position,
    })
  }

  return (
    <div className="flex min-h-full flex-col pb-1">
      {!hasAnyConversations ? (
        <div className="flex min-h-full flex-1 items-center justify-center px-4 py-6 text-center">
          <div className="flex max-w-[240px] flex-col items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-muted text-subtle-foreground">
              <FolderOpen size={22} />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">No project folders yet</p>
              <p className="text-sm leading-6 text-subtle-foreground">
                Add a project folder to start a thread
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div>
          {conversationGroups.map((group) => {
            const stateKey = group.folder.id ?? 'unfiled'
            const folderId = group.folder.id
            const isDraggable = folderId !== null
            const showDropIndicator =
              isDraggable && dropTarget?.folderId === folderId && draggedFolderId !== null && draggedFolderId !== folderId

            return (
              <ConversationFolderSection
                key={stateKey}
                group={group}
                isCollapsed={draggedFolderId !== null ? true : Boolean(collapsedFolderState[stateKey])}
                isDragging={isDraggable && draggedFolderId === folderId}
                isDraggable={isDraggable}
                dropIndicatorPosition={showDropIndicator ? dropTarget.position : null}
                onCreateConversation={onCreateConversation}
                onDragEnd={handleDragEnd}
                onDragOver={
                  folderId
                    ? (event) => {
                        handleDragOver(event, folderId)
                      }
                    : undefined
                }
                onDragStart={
                  folderId
                    ? (event) => {
                        handleDragStart(event, folderId)
                      }
                    : undefined
                }
                onDrop={
                  folderId
                    ? (event) => {
                        handleDrop(event, folderId)
                      }
                    : undefined
                }
                onToggleCollapsed={() => handleToggleFolder(group.folder.id)}
                onDeleteFolder={onDeleteFolder}
                onRenameFolder={onRenameFolder}
                onSelectFolder={onSelectFolder}
                onSelectConversation={onSelectConversation}
                onDeleteConversation={onDeleteConversation}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
