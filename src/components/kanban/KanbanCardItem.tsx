import {
  ArrowLeft,
  ArrowRight,
  Bug,
  CheckSquare2,
  CircleUserRound,
  GripVertical,
  Lightbulb,
  ListTodo,
} from 'lucide-react'
import type { DragEvent } from 'react'
import { KANBAN_COLUMNS } from './kanbanDefaults'
import type { KanbanCardDisplayMeta } from './kanbanHierarchy'
import { getKanbanPriorityOption } from './kanbanPresentation'
import type { KanbanCard, KanbanColumnId } from './kanbanTypes'

interface KanbanCardItemProps {
  card: KanbanCard
  index: number
  meta: KanbanCardDisplayMeta
  onDragEnd: () => void
  onDragStart: (cardId: string) => void
  onDropAt: (
    cardId: string,
    targetColumnId: KanbanColumnId,
    targetIndex: number,
  ) => void
  onMove: (cardId: string, targetColumnId: KanbanColumnId) => void
  onOpen: (cardId: string) => void
}

function getAdjacentColumnId(
  columnId: KanbanColumnId,
  direction: -1 | 1,
): KanbanColumnId | null {
  const currentIndex = KANBAN_COLUMNS.findIndex(
    (column) => column.id === columnId,
  )
  return KANBAN_COLUMNS[currentIndex + direction]?.id ?? null
}

function IssueTypeIcon({ issueType }: Pick<KanbanCard, 'issueType'>) {
  if (issueType === 'bug') {
    return <Bug size={13} />
  }
  if (issueType === 'idea') {
    return <Lightbulb size={13} />
  }
  return <ListTodo size={13} />
}

export function KanbanCardItem({
  card,
  index,
  meta,
  onDragEnd,
  onDragStart,
  onDropAt,
  onMove,
  onOpen,
}: KanbanCardItemProps) {
  const previousColumnId = getAdjacentColumnId(card.columnId, -1)
  const nextColumnId = getAdjacentColumnId(card.columnId, 1)
  const priority = getKanbanPriorityOption(card.priority)
  const completedCriteriaCount = card.acceptanceCriteria.filter(
    (criterion) => criterion.completed,
  ).length
  const hasFooterMetadata =
    Boolean(card.assignee) ||
    meta.childCount > 0 ||
    card.acceptanceCriteria.length > 0

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    event.stopPropagation()
    const draggedCardId = event.dataTransfer.getData(
      'application/x-tidecode-kanban-card',
    )
    if (draggedCardId && draggedCardId !== card.id) {
      onDropAt(draggedCardId, card.columnId, index)
    }
  }

  return (
    <article
      draggable
      tabIndex={0}
      aria-label={`Open task ${card.title}`}
      onClick={() => onOpen(card.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(card.id)
        }
      }}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData(
          'application/x-tidecode-kanban-card',
          card.id,
        )
        onDragStart(card.id)
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
      }}
      onDrop={handleDrop}
      className={[
        'group relative w-full min-w-0 cursor-pointer overflow-hidden rounded-xl border border-border bg-surface px-3 py-3 text-left transition-colors duration-150 hover:border-muted-foreground focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0',
        meta.isChild ? 'border-l-2' : '',
      ].join(' ')}
    >
      <div className="flex items-start gap-2.5">
        <span
          className="mt-0.5 hidden cursor-grab text-subtle-foreground group-hover:text-muted-foreground md:block"
          aria-hidden="true"
        >
          <GripVertical size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2 pt-1 text-[11px] font-semibold text-muted-foreground">
              <span className="inline-flex shrink-0 items-center gap-1">
                <IssueTypeIcon issueType={card.issueType} />
                {meta.isChild ? 'Subtask' : card.issueType}
              </span>
              {card.priority !== 'none' ? (
                <span className="inline-flex items-center gap-1">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${priority.colorClassName}`}
                  />
                  {priority.label}
                </span>
              ) : null}
            </div>

            <div className="-mr-1 -mt-1 flex shrink-0 items-center">
              <button
                type="button"
                disabled={!previousColumnId}
                onClick={(event) => {
                  event.stopPropagation()
                  if (previousColumnId) {
                    onMove(card.id, previousColumnId)
                  }
                }}
                className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground opacity-100 transition-colors hover:bg-surface-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-20 md:h-8 md:w-8 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
                aria-label="Move to previous column"
              >
                <ArrowLeft size={13} />
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
                className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground opacity-100 transition-colors hover:bg-surface-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-20 md:h-8 md:w-8 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100"
                aria-label="Move to next column"
              >
                <ArrowRight size={13} />
              </button>
            </div>
          </div>

          <h3 className="mt-1 line-clamp-2 break-words text-[13px] font-semibold leading-5 text-foreground">
            {card.title}
          </h3>

          {card.description ? (
            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
              {card.description}
            </p>
          ) : null}

          {card.labels.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {card.labels.slice(0, 3).map((label) => (
                <span
                  key={label}
                  className="max-w-28 truncate rounded-md bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                >
                  {label}
                </span>
              ))}
              {card.labels.length > 3 ? (
                <span className="px-1 py-0.5 text-[10px] text-subtle-foreground">
                  +{card.labels.length - 3}
                </span>
              ) : null}
            </div>
          ) : null}

          {hasFooterMetadata ? (
            <div className="mt-2.5 flex min-h-5 items-center gap-3 text-[11px] text-muted-foreground">
              {card.assignee ? (
                <span className="inline-flex min-w-0 items-center gap-1">
                  <CircleUserRound size={13} />
                  <span className="max-w-24 truncate">{card.assignee}</span>
                </span>
              ) : null}
              {meta.childCount > 0 ? (
                <span
                  className="inline-flex items-center gap-1"
                  title={`${meta.doneChildCount} of ${meta.childCount} subtasks done`}
                >
                  <ListTodo size={13} />
                  {meta.doneChildCount}/{meta.childCount}
                </span>
              ) : null}
              {card.acceptanceCriteria.length > 0 ? (
                <span
                  className="inline-flex items-center gap-1"
                  title={`${completedCriteriaCount} of ${card.acceptanceCriteria.length} acceptance criteria complete`}
                >
                  <CheckSquare2 size={13} />
                  {completedCriteriaCount}/{card.acceptanceCriteria.length}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  )
}
