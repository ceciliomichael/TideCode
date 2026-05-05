import { ArrowLeft, ArrowRight } from 'lucide-react'
import { KANBAN_COLUMNS } from './kanbanDefaults'
import type { KanbanCard, KanbanColumnId } from './kanbanTypes'

interface KanbanCardItemProps {
  card: KanbanCard
  onOpen: (cardId: string) => void
  onDragStart: (cardId: string) => void
  onMove: (cardId: string, targetColumnId: KanbanColumnId) => void
}

function getAdjacentColumnId(columnId: KanbanColumnId, direction: -1 | 1): KanbanColumnId | null {
  const currentIndex = KANBAN_COLUMNS.findIndex((column) => column.id === columnId)
  const nextColumn = KANBAN_COLUMNS[currentIndex + direction]
  return nextColumn?.id ?? null
}

export function KanbanCardItem({ card, onDragStart, onMove, onOpen }: KanbanCardItemProps) {
  const previousColumnId = getAdjacentColumnId(card.columnId, -1)
  const nextColumnId = getAdjacentColumnId(card.columnId, 1)

  return (
    <article
      draggable
      tabIndex={0}
      role="button"
      aria-label={`Open task ${card.title}`}
      onClick={() => onOpen(card.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(card.id)
        }
      }}
      onDragStart={() => onDragStart(card.id)}
      className="group flex cursor-grab items-center gap-2 border-b border-border px-4 py-2.5 text-left transition-colors hover:bg-surface-muted active:cursor-grabbing"
    >
      {/* Title — grows, truncates cleanly */}
      <p className="min-w-0 flex-1 truncate text-[13px] leading-5 text-foreground">
        {card.title}
      </p>

      {/* Move controls — fixed width, always vertically centred */}
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          disabled={!previousColumnId}
          onClick={(event) => {
            event.stopPropagation()
            if (previousColumnId) {
              onMove(card.id, previousColumnId)
            }
          }}
          className="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-surface text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-0"
          aria-label="Move to previous column"
        >
          <ArrowLeft size={11} />
        </button>
        <button
          type="button"
          disabled={!nextColumnId}
          onClick={(event) => {
            event.stopPropagation()
            if (nextColumnId) {
              onMove(card.id, nextColumnId)
            }
          }}
          className="inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-surface text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-0"
          aria-label="Move to next column"
        >
          <ArrowRight size={11} />
        </button>
      </div>
    </article>
  )
}
