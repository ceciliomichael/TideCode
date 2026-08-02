import { useState } from 'react'
import type { RefObject } from 'react'
import { ChevronDown, ChevronRight, Clock, Trash2 } from 'lucide-react'
import type { ChatAttachment, QueuedMessage } from '../../types/chat'
import { ChatQueueItem } from './ChatQueueItem'

interface ChatQueueBlockProps {
  queuedMessages: readonly QueuedMessage[]
  editCancelBoundaryRef?: RefObject<HTMLElement>
  onClearQueue?: () => void
  onRemove: (id: string) => void
  onReorder: (sourceId: string, targetId: string) => void
  onUpdate: (id: string, content: string, attachments?: ChatAttachment[]) => void
}

export function ChatQueueBlock({
  queuedMessages,
  editCancelBoundaryRef,
  onClearQueue,
  onRemove,
  onReorder,
  onUpdate,
}: ChatQueueBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [draggedMessageId, setDraggedMessageId] = useState<string | null>(null)

  if (queuedMessages.length === 0) {
    return null
  }

  function handleDrop(targetId: string) {
    if (draggedMessageId && draggedMessageId !== targetId) {
      onReorder(draggedMessageId, targetId)
    }

    setDraggedMessageId(null)
  }

  return (
    <div className="overflow-hidden rounded-t-2xl rounded-b-none border border-border border-b-0 bg-surface/50 shadow-sm">
      <button
        type="button"
        onClick={() => setIsExpanded((currentValue) => !currentValue)}
        className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-muted"
      >
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <Clock size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-medium leading-5 text-foreground">Queued messages</span>
              <span className="shrink-0 text-sm font-medium leading-5 text-muted-foreground">{`(${queuedMessages.length})`}</span>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 self-center text-muted-foreground">
          {onClearQueue ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onClearQueue()
              }}
              className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium transition-colors hover:bg-surface-muted hover:text-foreground"
            >
              <Trash2 size={13} />
              Clear all
            </button>
          ) : null}
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </button>

      {isExpanded ? (
        <div className="border-t border-border">
          <div className="max-h-72 overflow-y-auto">
            {queuedMessages.map((message, index) => (
              <ChatQueueItem
                key={message.id}
                index={index}
                message={message}
                editCancelBoundaryRef={editCancelBoundaryRef}
                onDragEnd={() => setDraggedMessageId(null)}
                onDragStart={setDraggedMessageId}
                onDrop={handleDrop}
                onRemove={onRemove}
                onUpdate={onUpdate}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
