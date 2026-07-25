import { Plus } from 'lucide-react'
import { useEffect, useState, type DragEvent } from 'react'
import type { KanbanCardDisplayMeta } from './kanbanHierarchy'
import { KanbanCardItem } from './KanbanCardItem'
import type {
  KanbanCard,
  KanbanColumnDefinition,
  KanbanColumnId,
} from './kanbanTypes'

interface KanbanColumnProps {
  cardMetaById: Map<string, KanbanCardDisplayMeta>
  cards: readonly KanbanCard[]
  column: KanbanColumnDefinition
  count: number
  draggedCardId: string | null
  onAdd: (columnId: KanbanColumnId) => void
  onCardDragEnd: () => void
  onCardDragStart: (cardId: string) => void
  onCardDropAt: (
    cardId: string,
    targetColumnId: KanbanColumnId,
    targetIndex: number,
  ) => void
  onCardMove: (cardId: string, targetColumnId: KanbanColumnId) => void
  onCardOpen: (cardId: string) => void
}

const COLUMN_MARKER_CLASS_NAMES: Record<KanbanColumnId, string> = {
  backlog: 'bg-slate-400',
  blocked: 'bg-red-500',
  done: 'bg-emerald-500',
  'in-progress': 'bg-blue-500',
}

export function KanbanColumn({
  cardMetaById,
  cards,
  column,
  count,
  draggedCardId,
  onAdd,
  onCardDragEnd,
  onCardDragStart,
  onCardDropAt,
  onCardMove,
  onCardOpen,
}: KanbanColumnProps) {
  const [isOver, setIsOver] = useState(false)

  useEffect(() => {
    if (!draggedCardId) {
      setIsOver(false)
    }
  }, [draggedCardId])

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
      setIsOver(false)
    }
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    setIsOver(false)
    const cardId =
      event.dataTransfer.getData('application/x-echosphere-kanban-card') ||
      draggedCardId
    if (cardId) {
      onCardDropAt(cardId, column.id, cards.length)
    }
  }

  return (
    <section
      onDragEnter={(event) => {
        event.preventDefault()
        setIsOver(true)
      }}
      onDragLeave={handleDragLeave}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
      }}
      onDrop={handleDrop}
      className={[
        'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border transition-colors duration-150',
        isOver && draggedCardId
          ? 'bg-[var(--dropdown-control-open-surface)]'
          : 'bg-surface-muted',
      ].join(' ')}
    >
      <header className="flex shrink-0 items-start justify-between gap-3 px-3.5 pb-2 pt-3.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${COLUMN_MARKER_CLASS_NAMES[column.id]}`}
            />
            <h2 className="text-xs font-bold uppercase tracking-[0.13em] text-foreground">
              {column.title}
            </h2>
            <span className="rounded-md bg-surface px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
              {count}
            </span>
          </div>
          <p className="mt-1.5 line-clamp-1 text-[11px] text-subtle-foreground">
            {column.description}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onAdd(column.id)}
          aria-label={`Add task to ${column.title}`}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface hover:text-foreground active:scale-95"
        >
          <Plus size={15} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {cards.length > 0 ? (
          <ul className="space-y-2">
            {cards.map((card, index) => (
              <li key={card.id} className="min-w-0">
                <KanbanCardItem
                  card={card}
                  index={index}
                  meta={
                    cardMetaById.get(card.id) ?? {
                      childCount: 0,
                      doneChildCount: 0,
                      isChild: false,
                      parentTitle: undefined,
                    }
                  }
                  onDragEnd={onCardDragEnd}
                  onDragStart={onCardDragStart}
                  onDropAt={onCardDropAt}
                  onMove={onCardMove}
                  onOpen={onCardOpen}
                />
              </li>
            ))}
          </ul>
        ) : (
          <button
            type="button"
            onClick={() => onAdd(column.id)}
            className="flex min-h-28 w-full items-center justify-center rounded-xl border border-dashed border-border bg-surface px-4 text-center text-xs text-muted-foreground transition-colors hover:border-muted-foreground hover:text-foreground"
          >
            Add the first task
          </button>
        )}
      </div>
    </section>
  )
}
