import { Check, Trash2, Pin, PinOff } from 'lucide-react'
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { LuLoader } from 'react-icons/lu'
import type { ConversationPreview } from '../../types/chat'
import { Tooltip } from '../Tooltip'

interface ConversationHistoryItemProps {
  conversation: ConversationPreview
  workspaceName?: string
  onDeleteConversation: (conversationId: string) => void
  onPinConversation: (conversationId: string, isPinned: boolean) => void
  onSelectConversation: (conversationId: string) => void
}

export function ConversationHistoryItem({
  conversation,
  onSelectConversation,
  onDeleteConversation,
  onPinConversation,
  workspaceName,
}: ConversationHistoryItemProps) {
  const [isDeleteConfirming, setIsDeleteConfirming] = useState(false)
  const deleteButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    setIsDeleteConfirming(false)
  }, [conversation.id])

  useEffect(() => {
    if (!isDeleteConfirming) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      const targetNode = event.target as Node | null
      if (!targetNode || deleteButtonRef.current?.contains(targetNode)) {
        return
      }

      setIsDeleteConfirming(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [isDeleteConfirming])

  function handleDeleteClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()

    if (isDeleteConfirming) {
      onDeleteConversation(conversation.id)
      return
    }

    setIsDeleteConfirming(true)
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
        isDeleteConfirming
          ? 'border-danger-border bg-danger-surface'
          : conversation.isActive
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
        {!isDeleteConfirming ? (
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

        {!isDeleteConfirming && (
          <Tooltip content={conversation.isPinned ? 'Unpin thread' : 'Pin thread'} side="top">
            <button
              type="button"
              onClick={handlePinClick}
              className={[
                'h-8 w-8 items-center justify-center rounded-full origin-center transform-gpu transition-[color,opacity,transform] duration-150 ease-out',
                conversation.isPinned ? 'flex text-foreground' : 'hidden text-subtle-foreground hover:scale-110 hover:text-foreground group-hover:flex'
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
        )}

        <Tooltip content={isDeleteConfirming ? 'Click again to delete thread' : 'Delete thread'} side="right">
          <button
            ref={deleteButtonRef}
            type="button"
            onClick={handleDeleteClick}
            className={[
              'h-8 w-8 items-center justify-center rounded-full origin-center transform-gpu transition-[color,opacity,transform] duration-150 ease-out',
              isDeleteConfirming
                ? 'flex text-danger-foreground hover:scale-110 hover:text-danger-foreground-hover'
                : 'hidden text-subtle-foreground hover:scale-110 hover:text-foreground group-hover:flex',
            ].join(' ')}
            aria-label={isDeleteConfirming ? `Confirm delete thread ${conversation.title}` : `Delete thread ${conversation.title}`}
          >
            {isDeleteConfirming ? (
              <Check size={15} strokeWidth={2.4} className="block" />
            ) : (
              <Trash2 size={15} strokeWidth={2} className="block" />
            )}
          </button>
        </Tooltip>
      </div>
    </div>
  )
}
