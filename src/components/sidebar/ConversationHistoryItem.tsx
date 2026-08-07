import { Archive, ArchiveRestore, Pin, PinOff, Trash2 } from 'lucide-react'
import { useState, type MouseEvent } from 'react'
import { LuLoader } from 'react-icons/lu'
import type { ConversationPreview } from '../../types/chat'
import { Tooltip } from '../Tooltip'
import { ConversationDeleteDialog } from './ConversationDeleteDialog'

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
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

  function handleArchiveClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    onArchiveConversation(conversation.id, !conversation.isArchived)
  }

  function handleDeleteClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    setIsDeleteDialogOpen(true)
  }

  function handleConfirmDelete() {
    setIsDeleteDialogOpen(false)
    onDeleteConversation(conversation.id)
  }

  function handlePinClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()

    onPinConversation(conversation.id, !conversation.isPinned)
  }

  return (
    <div
      className={[
        'group relative flex w-full items-center gap-2 rounded-xl border border-transparent px-2 py-0.5 transition-[background-color,border-color,box-shadow]',
        conversation.compaction
          ? 'ml-3 w-[calc(100%-0.75rem)] before:absolute before:-left-2 before:bottom-1 before:top-1 before:w-px before:bg-border'
          : '',
        conversation.isActive
          ? 'border-[var(--sidebar-item-active-border)] bg-[var(--sidebar-item-active-surface)]'
          : 'hover:bg-[var(--sidebar-hover-surface)]',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={() => onSelectConversation(conversation.id)}
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

      <div
        onClick={() => onSelectConversation(conversation.id)}
        className="flex h-8 w-[96px] shrink-0 cursor-pointer items-center justify-end"
      >
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

        {!conversation.isArchived ? (
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

        {conversation.isArchived ? (
          <Tooltip content="Delete archived thread" side="top">
            <button
              type="button"
              onClick={handleDeleteClick}
              className="hidden h-8 w-8 origin-center transform-gpu items-center justify-center rounded-full text-subtle-foreground transition-[color,opacity,transform] duration-150 ease-out hover:scale-110 hover:text-destructive group-hover:flex"
              aria-label={`Delete archived thread ${conversation.title}`}
            >
              <Trash2 size={15} strokeWidth={2} className="block" />
            </button>
          </Tooltip>
        ) : null}
      </div>
      {isDeleteDialogOpen ? (
        <ConversationDeleteDialog
          conversationTitle={conversation.title}
          onClose={() => setIsDeleteDialogOpen(false)}
          onConfirm={handleConfirmDelete}
        />
      ) : null}
    </div>
  )
}
