import { ChevronDown, ChevronRight, Folder, FolderOpen, MoreHorizontal, SquarePen } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type DragEventHandler } from 'react'
import { createPortal } from 'react-dom'
import type { ConversationGroupPreview } from '../../types/chat'
import { Tooltip } from '../Tooltip'
import { ConversationHistoryItem } from './ConversationHistoryItem'
import { RemoveProjectFolderDialog } from './RemoveProjectFolderDialog'
import { PINNED_FOLDER_ID } from '../../hooks/chatHistoryViewModels'
import type { FolderReorderPosition } from '../../types/chat'

interface ConversationFolderSectionProps {
  group: ConversationGroupPreview
  isCollapsed: boolean
  onCreateConversation: (folderId?: string | null) => void
  onArchiveConversation: (conversationId: string, isArchived: boolean) => void
  onDeleteConversation: (conversationId: string) => void
  onPinConversation: (conversationId: string, isPinned: boolean) => void
  onDeleteFolder: (folderId: string) => Promise<void>
  onRenameFolder: (folderId: string, name: string) => Promise<void>
  onSelectFolder: (folderId: string | null) => void
  onSelectConversation: (conversationId: string) => void
  onToggleCollapsed: () => void
  dropIndicatorPosition: FolderReorderPosition | null
  isDraggable: boolean
  isDragging: boolean
  onDragEnd: DragEventHandler<HTMLElement>
  onDragOver?: DragEventHandler<HTMLElement>
  onDragStart?: DragEventHandler<HTMLElement>
  onDrop?: DragEventHandler<HTMLElement>
}

const MAX_VISIBLE_PROJECT_FOLDER_THREADS = 5

export function ConversationFolderSection({
  group,
  isCollapsed,
  onCreateConversation,
  onToggleCollapsed,
  onRenameFolder,
  onDeleteFolder,
  onSelectFolder,
   onSelectConversation,
   onArchiveConversation,
   onDeleteConversation,
   onPinConversation,
  dropIndicatorPosition,
  isDraggable,
  isDragging,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
}: ConversationFolderSectionProps) {
  const FolderIcon = group.folder.isSelected ? FolderOpen : Folder
  const hasFolderActions = group.folder.id !== null && group.folder.id !== PINNED_FOLDER_ID
  const [visibleThreadCount, setVisibleThreadCount] = useState(MAX_VISIBLE_PROJECT_FOLDER_THREADS)
  const [recentlyAddedStartIndex, setRecentlyAddedStartIndex] = useState<number | null>(null)
  const [isThreadListCollapsing, setIsThreadListCollapsing] = useState(false)
  const showMoreResetTimeoutRef = useRef<number | null>(null)
  const addAnimationResetTimeoutRef = useRef<number | null>(null)
  const visibleConversations = group.conversations.slice(0, visibleThreadCount)
  const runningConversations = group.conversations.filter((conversation) => conversation.hasRunningTask)
  const remainingThreadCount = Math.max(group.conversations.length - visibleConversations.length, 0)
  const canShowLessThreads = remainingThreadCount === 0 && group.conversations.length > MAX_VISIBLE_PROJECT_FOLDER_THREADS

  const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false)
  const [isRemoveDialogOpen, setIsRemoveDialogOpen] = useState(false)
  const [isRemovingFolder, setIsRemovingFolder] = useState(false)
  const actionsMenuRootRef = useRef<HTMLDivElement | null>(null)
  const actionsMenuButtonRef = useRef<HTMLButtonElement | null>(null)
  const actionsMenuRef = useRef<HTMLDivElement | null>(null)
  const [actionsMenuStyle, setActionsMenuStyle] = useState<CSSProperties>({
    left: 0,
    maxHeight: 0,
    top: 0,
    visibility: 'hidden',
  })

  const updateActionsMenuPosition = useCallback(() => {
    const buttonElement = actionsMenuButtonRef.current
    const menuElement = actionsMenuRef.current
    const buttonRect = buttonElement?.getBoundingClientRect()
    const menuRect = menuElement?.getBoundingClientRect()

    if (!buttonRect || !menuElement) {
      return
    }

    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const menuWidth = menuRect?.width ?? menuElement.scrollWidth
    const menuHeight = menuElement.scrollHeight
    const offset = 6
    const edgePadding = 8
    const settingsButtonRect =
      document.querySelector<HTMLButtonElement>('button[aria-label="Open settings"]')?.getBoundingClientRect() ?? null
    const menuBottomLimit = settingsButtonRect
      ? Math.max(settingsButtonRect.top - edgePadding, edgePadding)
      : viewportHeight - edgePadding
    const availableBelow = Math.max(menuBottomLimit - buttonRect.bottom - offset, 0)
    const availableAbove = Math.max(buttonRect.top - offset - edgePadding, 0)
    const shouldOpenAbove = availableBelow < menuHeight && availableAbove > 0
    const maxHeight = shouldOpenAbove ? availableAbove : availableBelow
    const top = shouldOpenAbove
      ? Math.max(edgePadding, buttonRect.top - Math.min(menuHeight, maxHeight) - offset)
      : buttonRect.bottom + offset

    const unclampedLeft = buttonRect.right - menuWidth
    const maxLeft = Math.max(viewportWidth - menuWidth - edgePadding, edgePadding)
    const left = Math.min(Math.max(unclampedLeft, edgePadding), maxLeft)

    setActionsMenuStyle((currentValue) => {
      if (
        currentValue.left === left &&
        currentValue.maxHeight === maxHeight &&
        currentValue.top === top &&
        currentValue.visibility === 'visible'
      ) {
        return currentValue
      }

      return {
        left,
        maxHeight,
        top,
        visibility: 'visible',
      }
    })
  }, [])

  useLayoutEffect(() => {
    if (!isActionsMenuOpen) {
      return
    }

    updateActionsMenuPosition()
  })

  useLayoutEffect(() => {
    if (!isActionsMenuOpen) {
      return
    }

    updateActionsMenuPosition()
    const animationFrameId = window.requestAnimationFrame(updateActionsMenuPosition)
    const resizeObserver =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            updateActionsMenuPosition()
          })
        : null

    if (resizeObserver && actionsMenuRef.current) {
      resizeObserver.observe(actionsMenuRef.current)
    }

    window.addEventListener('resize', updateActionsMenuPosition)
    window.addEventListener('scroll', updateActionsMenuPosition, true)

    return () => {
      window.cancelAnimationFrame(animationFrameId)
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updateActionsMenuPosition)
      window.removeEventListener('scroll', updateActionsMenuPosition, true)
    }
  }, [isActionsMenuOpen, updateActionsMenuPosition])

  useEffect(() => {
    return () => {
      if (showMoreResetTimeoutRef.current !== null) {
        window.clearTimeout(showMoreResetTimeoutRef.current)
      }
      if (addAnimationResetTimeoutRef.current !== null) {
        window.clearTimeout(addAnimationResetTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!hasFolderActions || !isActionsMenuOpen) {
      return
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }

      if (actionsMenuRootRef.current?.contains(target) || actionsMenuRef.current?.contains(target)) {
        return
      }

      setIsActionsMenuOpen(false)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsActionsMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [hasFolderActions, isActionsMenuOpen])

  function handleShowMoreThreads() {
    if (remainingThreadCount <= 0) {
      return
    }

    setVisibleThreadCount((currentValue) => {
      const nextValue = Math.min(currentValue + MAX_VISIBLE_PROJECT_FOLDER_THREADS, group.conversations.length)

      if (nextValue > currentValue) {
        setRecentlyAddedStartIndex(currentValue)
        if (addAnimationResetTimeoutRef.current !== null) {
          window.clearTimeout(addAnimationResetTimeoutRef.current)
        }

        addAnimationResetTimeoutRef.current = window.setTimeout(() => {
          setRecentlyAddedStartIndex(null)
        }, 280)
      }

      return nextValue
    })
  }

  function handleShowLessThreads() {
    if (!canShowLessThreads) {
      return
    }

    setIsThreadListCollapsing(true)

    if (showMoreResetTimeoutRef.current !== null) {
      window.clearTimeout(showMoreResetTimeoutRef.current)
    }

    showMoreResetTimeoutRef.current = window.setTimeout(() => {
      setVisibleThreadCount(MAX_VISIBLE_PROJECT_FOLDER_THREADS)
      setIsThreadListCollapsing(false)
      setRecentlyAddedStartIndex(null)
    }, 170)
  }

  function handleRenameFolder() {
    if (!group.folder.id) {
      return
    }

    setIsActionsMenuOpen(false)
    const nextName = window.prompt('Rename project folder', group.folder.name)
    if (nextName === null) {
      return
    }

    void onRenameFolder(group.folder.id, nextName)
  }

  function handleRemoveFolder() {
    if (!group.folder.id) {
      return
    }

    setIsActionsMenuOpen(false)
    setIsRemoveDialogOpen(true)
  }

  async function handleConfirmRemoveFolder() {
    if (!group.folder.id) {
      return
    }

    setIsRemovingFolder(true)
    try {
      await onDeleteFolder(group.folder.id)
      setIsRemoveDialogOpen(false)
    } finally {
      setIsRemovingFolder(false)
    }
  }

  return (
    <section className="space-y-2 py-1.5" onDragOver={onDragOver} onDrop={onDrop}>
      <div className="relative">
        {dropIndicatorPosition === 'before' ? (
          <div className="pointer-events-none absolute -top-1.5 left-2 right-2 h-0.5 rounded-full bg-border" />
        ) : null}
        <div
          draggable={isDraggable}
          onDragEnd={onDragEnd}
          onDragStart={onDragStart}
          className={[
            'group flex h-11 min-w-0 items-center gap-1 rounded-2xl border px-2 text-left transition-colors',
            isDraggable ? 'cursor-grab active:cursor-grabbing' : '',
            isDragging ? 'opacity-60' : '',
            group.folder.isSelected
              ? 'border-border bg-[var(--sidebar-raised-surface)]'
              : 'border-transparent bg-[var(--sidebar-muted-surface-mix)] hover:border-border/60 hover:bg-[var(--sidebar-hover-surface)]',
          ].join(' ')}
          aria-label={isDraggable ? `Reorder ${group.folder.name}` : undefined}
        >
        <Tooltip content={isCollapsed ? `Expand ${group.folder.name}` : `Collapse ${group.folder.name}`}>
          <button
            type="button"
            onClick={onToggleCollapsed}
            className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--sidebar-hover-surface)] hover:text-foreground"
            aria-label={isCollapsed ? `Expand ${group.folder.name}` : `Collapse ${group.folder.name}`}
          >
            <FolderIcon
              size={16}
              strokeWidth={2.1}
              className={[
                'absolute transition-opacity duration-150 ease-out group-hover:opacity-0',
                group.folder.isSelected ? 'text-brand' : 'text-muted-foreground',
              ].join(' ')}
            />
            {isCollapsed ? (
              <ChevronRight
                size={16}
                strokeWidth={2.2}
                className="absolute opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100"
              />
            ) : (
              <ChevronDown
                size={16}
                strokeWidth={2.2}
                className="absolute opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100"
              />
            )}
          </button>
        </Tooltip>

        <button
          type="button"
          onClick={() => onSelectFolder(group.folder.id)}
          className="min-w-0 flex-1 text-left"
        >
          <span
            className={[
              'block truncate text-sm',
              group.folder.isSelected ? 'font-semibold text-brand-soft-foreground' : 'font-medium text-foreground',
            ].join(' ')}
          >
            {group.folder.name}
          </span>
        </button>

        {hasFolderActions ? (
          <div className="flex shrink-0 items-center gap-0.5">
            <div ref={actionsMenuRootRef} className="relative">
              <Tooltip content="Project folder actions" side="right">
                <button
                  ref={actionsMenuButtonRef}
                  type="button"
                  aria-label={`Project folder actions for ${group.folder.name}`}
                  aria-haspopup="menu"
                  aria-expanded={isActionsMenuOpen}
                  onClick={() => setIsActionsMenuOpen((currentValue) => !currentValue)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground"
                >
                  <MoreHorizontal size={16} strokeWidth={2.1} />
                </button>
              </Tooltip>
            </div>

            <Tooltip content={`Start new thread in ${group.folder.name}`} side="right">
              <button
                type="button"
                onClick={() => onCreateConversation(group.folder.id)}
                className="flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground"
                aria-label={`Start new thread in ${group.folder.name}`}
              >
                <SquarePen size={16} strokeWidth={2.1} />
              </button>
            </Tooltip>
          </div>
        ) : group.folder.id !== PINNED_FOLDER_ID ? (
          <Tooltip content={`Start new thread in ${group.folder.name}`} side="right">
            <button
              type="button"
              onClick={() => onCreateConversation(group.folder.id)}
              className="flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground"
              aria-label={`Start new thread in ${group.folder.name}`}
            >
              <SquarePen size={16} strokeWidth={2.1} />
            </button>
          </Tooltip>
        ) : null}
        </div>
        {dropIndicatorPosition === 'after' ? (
          <div className="pointer-events-none absolute -bottom-1.5 left-2 right-2 h-0.5 rounded-full bg-border" />
        ) : null}
      </div>

      {isCollapsed ? (
        runningConversations.length > 0 ? (
          <div className="space-y-1.5 px-0 pt-0.5">
            {runningConversations.map((conversation) => (
              <ConversationHistoryItem
                key={conversation.id}
                conversation={conversation}
                 onSelectConversation={onSelectConversation}
                 onArchiveConversation={onArchiveConversation}
                 onDeleteConversation={onDeleteConversation}
                 onPinConversation={onPinConversation}
              />
            ))}
          </div>
        ) : null
      ) : (
        <div className="mt-0.5 space-y-2 px-0 pb-0.5 pt-0.5">
          {group.conversations.length === 0 ? (
            <div className="flex items-center justify-center py-3 text-center">
              <p className="text-xs font-medium text-muted-foreground">No threads yet</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {visibleConversations.map((conversation, index) => {
                const isRecentlyAdded =
                  recentlyAddedStartIndex !== null &&
                  !isThreadListCollapsing &&
                  index >= recentlyAddedStartIndex
                const isCollapsingAway = isThreadListCollapsing && index >= MAX_VISIBLE_PROJECT_FOLDER_THREADS

                return (
                  <div
                    key={conversation.id}
                    className={[
                      'transition-[opacity,transform] duration-180 ease-out',
                      isRecentlyAdded ? 'sidebar-thread-item-enter' : '',
                      isCollapsingAway ? 'translate-y-1 opacity-0' : 'translate-y-0 opacity-100',
                    ].join(' ')}
                  >
                    <ConversationHistoryItem
                      conversation={conversation}
                       onSelectConversation={onSelectConversation}
                       onArchiveConversation={onArchiveConversation}
                       onDeleteConversation={onDeleteConversation}
                       onPinConversation={onPinConversation}                    />
                  </div>
                )
              })}
              {remainingThreadCount > 0 || canShowLessThreads ? (
                <div className="px-4 py-1">
                  {remainingThreadCount > 0 ? (
                    <button
                      type="button"
                      onClick={handleShowMoreThreads}
                      className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Show more
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleShowLessThreads}
                      className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Show less
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}
      {isActionsMenuOpen
        ? createPortal(
            <div
              ref={actionsMenuRef}
              data-floating-menu-root="true"
              role="menu"
              aria-label={`Project folder actions for ${group.folder.name}`}
              className="fixed z-[1200] min-w-[200px] overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-soft"
              style={actionsMenuStyle}
            >
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleRenameFolder}
                  className="flex h-10 w-full items-center rounded-lg px-2.5 text-left text-sm text-foreground transition-colors hover:bg-surface-muted"
                >
                  Rename project folder
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleRemoveFolder}
                  className="flex h-10 w-full items-center rounded-lg px-2.5 text-left text-sm text-danger-foreground transition-colors hover:bg-danger-surface"
                >
                  Remove project folder
                </button>
              </div>,
            document.body,
          )
        : null}
      {isRemoveDialogOpen ? (
        <RemoveProjectFolderDialog
          folderName={group.folder.name}
          isBusy={isRemovingFolder}
          onCancel={() => {
            if (isRemovingFolder) {
              return
            }

            setIsRemoveDialogOpen(false)
          }}
          onConfirm={() => {
            void handleConfirmRemoveFolder()
          }}
        />
      ) : null}
    </section>
  )
}
