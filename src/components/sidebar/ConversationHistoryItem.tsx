import { Archive, ArchiveRestore, Check, Pin, PinOff, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { LuLoader } from 'react-icons/lu'
import type { ConversationPreview } from '../../types/chat'
import { Tooltip } from '../Tooltip'

interface ConversationHistoryItemProps {
  conversation: ConversationPreview
  workspaceName?: string
  onArchiveConversation: (conversationId: string, isArchived: boolean) => void
  onDeleteConversation: (conversationId: string) => void
  onPinConversation: (conversationId: string, isPinned: boolean) => void
  onSelectConversation: (conversationId: string) => void
}

export function ConversationHistoryItem({
  conversation,
  onSelectConversation,
  onArchiveConversation,
  onDeleteConversation,
  onPinConversation,
  workspaceName,
}: ConversationHistoryItemProps) {
  const [isDeleteConfirmationVisible, setIsDeleteConfirmationVisible] = useState(false)
  const itemRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isDeleteConfirmationVisible) {
      return
    }

    function handleDocumentMouseDown(event: globalThis.MouseEvent) {
      if (!itemRef.current?.contains(event.target as Node)) {
        setIsDeleteConfirmationVisible(false)
      }
    }

    document.addEventListener('mousedown', handleDocumentMouseDown)
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown)
  }, [isDeleteConfirmationVisible])

  function handleArchiveClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    onArchiveConversation(conversation.id, !conversation.isArchived)
  }

  function handleItemClick(event: MouseEvent<HTMLElement>) {
    event.preventDefault()
    event.stopPropagation()
    if (isDeleteConfirmationVisible) {
      onDeleteConversation(conversation.id)
    } else {
      onSelectConversation(conversation.id)
    }
  }

  function handlePinClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()

    onPinConversation(conversation.id, !conversation.isPinned)
  }

  return (
    <Tooltip
      content="Click to delete permanently"
      disabled={!isDeleteConfirmationVisible}
      fullWidthTrigger
      side="top"
    >
      <div
        ref={itemRef}
        onClick={handleItemClick}
        className={[
          'group relative flex w-full items-center gap-2 rounded-xl border border-transparent px-2 py-0.5 transition-[background-color,border-color,box-shadow]',
          conversation.compaction
            ? 'ml-3 w-[calc(100%-0.75rem)] before:absolute before:-left-2 before:bottom-1 before:top-1 before:w-px before:bg-border'
            : '',
          isDeleteConfirmationVisible
            ? 'cursor-pointer border-danger-border bg-danger-surface'
            : conversation.isActive
              ? 'border-[var(--sidebar-item-active-border)] bg-[var(--sidebar-item-active-surface)]'
              : 'hover:bg-[var(--sidebar-hover-surface)]',
        ].join(' ')}
      >
      <button
        type="button"
        onClick={handleItemClick}
        className={[
          'min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left transition-colors',
          conversation.isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        ].join(' ')}
      >
        <span className="flex min-w-0 items-start gap-1.5">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-inherit">{conversation.title}</span>
            {workspaceName ? (
              <span className="mt-0.5 block truncate text-[11px] font-medium text-subtle-foreground">
                {workspaceName}
              </span>
            ) : null}
          </span>
          {conversation.compactionLabel ? (
            <span className="mt-0.5 shrink-0 rounded-md bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-subtle-foreground">
              {conversation.compactionLabel}
              {conversation.isLatestCompaction ? ' · latest' : ''}
            </span>
          ) : null}
        </span>
      </button>

      <div className="flex h-8 w-[96px] shrink-0 cursor-pointer items-center justify-end">
        {!conversation.isArchived ? (
          conversation.hasRunningTask ? (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-medium text-subtle-foreground group-hover:hidden">
              <LuLoader className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              <span>Running</span>
            </span>
          ) : (
            <span className="whitespace-nowrap text-[11px] font-medium tabular-nums text-subtle-foreground group-hover:hidden">
              {conversation.updatedAtLabel}
            </span>
          )
        ) : null}

        {!conversation.isArchived && !isDeleteConfirmationVisible ? (
          <Tooltip content={conversation.isPinned ? 'Unpin thread' : 'Pin thread'} side="top">
            <button
              type="button"
              onClick={handlePinClick}
              className={[
                'h-8 w-8 origin-center transform-gpu items-center justify-center rounded-full transition-[color,opacity,transform] duration-150 ease-out',
                conversation.isPinned
                  ? 'flex text-foreground'
                  : 'hidden text-subtle-foreground hover:scale-110 hover:text-foreground group-hover:flex',
              ].join(' ')}
              aria-label={conversation.isPinned ? `Unpin thread ${conversation.title}` : `Pin thread ${conversation.title}`}
            >
              {conversation.isPinned ? (
                <PinOff size={15} strokeWidth={2.4} className="block" />
              ) : (
                <Pin size={15} strokeWidth={2} className="block" />
              )}
            </button>
          </Tooltip>
        ) : null}

        {!isDeleteConfirmationVisible ? (
          <Tooltip content={conversation.isArchived ? 'Unarchive thread' : 'Archive thread'} side="right">
            <button
              type="button"
              onClick={handleArchiveClick}
              className="hidden h-8 w-8 origin-center transform-gpu items-center justify-center rounded-full text-subtle-foreground transition-[color,opacity,transform] duration-150 ease-out hover:scale-110 hover:text-foreground group-hover:flex"
              aria-label={conversation.isArchived ? `Unarchive thread ${conversation.title}` : `Archive thread ${conversation.title}`}
            >
              {conversation.isArchived ? (
                <ArchiveRestore size={15} strokeWidth={2} className="block" />
              ) : (
                <Archive size={15} strokeWidth={2} className="block" />
              )}
            </button>
          </Tooltip>
        ) : null}

        {conversation.isArchived ? (
          isDeleteConfirmationVisible ? (
            <span
              className="flex h-8 w-8 items-center justify-center text-danger-foreground"
              aria-label={`Confirm deleting archived thread ${conversation.title}`}
            >
              <Check size={15} strokeWidth={2.5} className="block" />
            </span>
          ) : (
            <Tooltip content="Delete archived thread" side="top">
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setIsDeleteConfirmationVisible(true)
                }}
                className="hidden h-8 w-8 origin-center transform-gpu items-center justify-center text-subtle-foreground transition-[color,opacity,transform] duration-150 ease-out hover:scale-110 hover:text-destructive group-hover:flex"
                aria-label={`Delete archived thread ${conversation.title}`}
              >
                <Trash2 size={15} strokeWidth={2} className="block" />
              </button>
            </Tooltip>
          )
        ) : null}
      </div>
      </div>
    </Tooltip>
  )
}
