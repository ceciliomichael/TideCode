import type { DragEvent } from 'react'
import { KanbanCardItem } from './KanbanCardItem'
import type { KanbanCard, KanbanColumnDefinition, KanbanColumnId } from './kanbanTypes'

interface KanbanColumnProps {
  cards: readonly KanbanCard[]
  column: KanbanColumnDefinition
  count: number
  draggedCardId: string | null
  draggedMessageId: string | null
  onCardOpen: (cardId: string) => void
  onCardDragStart: (cardId: string) => void
  onCardMove: (cardId: string, targetColumnId: KanbanColumnId) => void
  onCardDrop: (cardId: string, targetColumnId: KanbanColumnId) => void
  onMessageDrop: (messageId: string, targetColumnId: KanbanColumnId) => void
}

export function KanbanColumn({
  cards,
  column,
  count,
  draggedCardId,
  draggedMessageId,
  onCardOpen,
  onCardDragStart,
  onCardDrop,
  onCardMove,
  onMessageDrop,
}: KanbanColumnProps) {
  const isDropTarget = draggedCardId !== null || draggedMessageId !== null

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.dataTransfer.dropEffect = draggedMessageId !== null ? 'copy' : 'move'
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    // Message pill dropped onto a column
    const messageId = event.dataTransfer.getData('kanban/message-id')
    if (messageId) {
      onMessageDrop(messageId, column.id)
      return
    }
    // Existing card drag
    if (!draggedCardId) {
      return
    }

    onCardDrop(draggedCardId, column.id)
  }

  return (
    <section
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={[
        'flex min-h-0 flex-1 flex-col overflow-hidden bg-surface transition-colors',
        isDropTarget ? 'bg-surface-muted' : '',
      ].join(' ')}
    >
      {/* Column header — flat strip */}
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground">{column.title}</span>
          <span className="rounded-sm bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground">
            {count}
          </span>
        </div>
      </header>

      {/* Cards list — scrollable, fills remaining height */}
      <div className="flex flex-1 flex-col overflow-y-auto">
        {cards.length > 0 ? (
          <ul className="flex flex-col">
            {cards.map((card) => (
              <li key={card.id}>
                <KanbanCardItem card={card} onDragStart={onCardDragStart} onMove={onCardMove} onOpen={onCardOpen} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-4 text-center">
            <span className="text-[11px] text-subtle-foreground">Drop a task here</span>
          </div>
        )}
      </div>
    </section>
  )
}
