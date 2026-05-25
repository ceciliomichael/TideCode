import { ArrowLeft, ArrowRight } from 'lucide-react'
import { KANBAN_COLUMNS } from './kanbanDefaults'
import type { KanbanCard, KanbanColumnId } from './kanbanTypes'
import type { KanbanCardDisplayMeta } from './kanbanHierarchy'

interface KanbanCardItemProps {
  card: KanbanCard
  meta: KanbanCardDisplayMeta
  onOpen: (cardId: string) => void
  onDragStart: (cardId: string) => void
  onMove: (cardId: string, targetColumnId: KanbanColumnId) => void
}

function getAdjacentColumnId(columnId: KanbanColumnId, direction: -1 | 1): KanbanColumnId | null {
  const currentIndex = KANBAN_COLUMNS.findIndex((column) => column.id === columnId)
  const nextColumn = KANBAN_COLUMNS[currentIndex + direction]
  return nextColumn?.id ?? null
}

export function KanbanCardItem({ card, meta, onDragStart, onMove, onOpen }: KanbanCardItemProps) {
  const previousColumnId = getAdjacentColumnId(card.columnId, -1)
  const nextColumnId = getAdjacentColumnId(card.columnId, 1)
  const progressLabel = meta.childCount > 0 ? `${meta.doneChildCount}/${meta.childCount} subtasks done` : null
  const parentLabel = meta.isChild && meta.parentTitle ? `Parent: ${meta.parentTitle}` : null

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
      className={[
        'group flex cursor-grab items-start gap-2 border-b border-border px-4 py-2.5 text-left transition-colors hover:bg-surface-muted active:cursor-grabbing',
        meta.isChild ? 'pl-6' : '',
      ].join(' ')}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="min-w-0 truncate text-[13px] leading-5 text-foreground">{card.title}</p>
          {meta.isChild ? (
            <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-subtle-foreground">
              Subtask
            </span>
          ) : null}
          {progressLabel ? (
            <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {progressLabel}
            </span>
          ) : null}
        </div>
        {parentLabel ? <p className="truncate text-[11px] text-subtle-foreground">{parentLabel}</p> : null}
      </div>

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
