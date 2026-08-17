import { useMemo, useState } from 'react'
import { CheckCircle2, Plus, Search, X } from 'lucide-react'
import type { Message } from '../../types/chat'
import { DropdownField, type DropdownOption } from '../ui/DropdownField'
import { KANBAN_COLUMNS } from './kanbanDefaults'
import { buildKanbanBoardDisplayData } from './kanbanHierarchy'
import { doesKanbanCardMatchQuery } from './kanbanPresentation'
import { COLUMN_MARKER_CLASS_NAMES, KanbanColumn } from './KanbanColumn'
import { KanbanErrorDialog } from './KanbanErrorDialog'
import { KanbanTaskDetails } from './KanbanTaskDetails'
import { KanbanTaskDialog } from './KanbanTaskDialog'
import type {
  KanbanColumnId,
  KanbanCreateTaskInput,
  KanbanPriority,
} from './kanbanTypes'
import { useKanbanAiPlanner } from './useKanbanAiPlanner'
import { useKanbanBoardState } from './useKanbanBoardState'

interface KanbanBoardProps {
  workspacePath: string | null
  messages: readonly Message[]
}

interface TaskComposerState {
  columnId: KanbanColumnId
  title: string
}

const PRIORITY_FILTERS: readonly DropdownOption[] = [
  { label: 'All priorities', value: 'all' },
  { label: 'Urgent', value: 'urgent' },
  { label: 'High', value: 'high' },
  { label: 'Medium', value: 'medium' },
  { label: 'Low', value: 'low' },
]

export function KanbanBoard({ workspacePath, messages }: KanbanBoardProps) {
  const [composerState, setComposerState] = useState<TaskComposerState | null>(
    null,
  )
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [priorityFilter, setPriorityFilter] = useState<KanbanPriority | 'all'>(
    'all',
  )
  const [mobileColumnId, setMobileColumnId] =
    useState<KanbanColumnId>('backlog')
  const {
    addCard,
    cards,
    clearCompletedCards,
    createTask,
    deleteCard,
    dismissError,
    error,
    isBusy,
    isLoading,
    moveCard,
    reorderCard,
    updateCard,
  } = useKanbanBoardState({
    workspacePath,
    messages,
  })
  const aiPlanner = useKanbanAiPlanner({ workspacePath })

  const filteredCards = useMemo(
    () =>
      cards.filter(
        (card) =>
          doesKanbanCardMatchQuery(card, searchQuery) &&
          (priorityFilter === 'all' || card.priority === priorityFilter),
      ),
    [cards, priorityFilter, searchQuery],
  )
  const boardDisplayData = useMemo(
    () => buildKanbanBoardDisplayData(filteredCards),
    [filteredCards],
  )
  const selectedCard = selectedCardId
    ? (cards.find((card) => card.id === selectedCardId) ?? null)
    : null
  const doneCardCount = cards.filter((card) => card.columnId === 'done').length
  const blockedCardCount = cards.filter(
    (card) => card.columnId === 'blocked',
  ).length
  const activeCardCount = cards.filter(
    (card) => card.columnId === 'in-progress',
  ).length
  const columnCounts = KANBAN_COLUMNS.reduce(
    (accumulator, column) => {
      accumulator[column.id] = filteredCards.filter(
        (card) => card.columnId === column.id,
      ).length
      return accumulator
    },
    {} as Record<KanbanColumnId, number>,
  )
  const activeError = error ?? aiPlanner.error
  const errorTask =
    activeError?.relatedCardId !== undefined
      ? (cards.find((card) => card.id === activeError.relatedCardId) ?? null)
      : null

  function dismissActiveError() {
    dismissError()
    aiPlanner.dismissError()
  }

  function openComposer(columnId: KanbanColumnId = 'backlog', title = '') {
    setComposerState({
      columnId,
      title,
    })
  }

  async function handleCreateTask(input: KanbanCreateTaskInput) {
    const result = await createTask(input)
    if (result) {
      setComposerState(null)
      setSelectedCardId(result.parent.id)
    }
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b border-border bg-surface px-4 py-3 md:px-5">
        <div className="space-y-3 xl:hidden">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">
                  Work board
                </h1>
                {isBusy ? (
                  <span className="rounded-md border border-border bg-surface-muted px-2 py-1 text-[10px] font-semibold text-muted-foreground">
                    Saving…
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {activeCardCount} active · {blockedCardCount} blocked ·{' '}
                {doneCardCount} done
              </p>
            </div>
            <button
              type="button"
              onClick={() => openComposer()}
              className="hidden h-11 shrink-0 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted md:inline-flex"
            >
              <Plus size={16} />
              New task
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle-foreground"
              />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search tasks, labels, owners…"
                className="h-11 w-full rounded-xl border border-border bg-background pl-9 pr-9 text-sm text-foreground shadow-none placeholder:text-subtle-foreground focus:border-border focus:outline-none focus:ring-0 focus:shadow-none"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear task search"
                  className="absolute right-1 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>
            <div className="hidden w-48 shrink-0 md:block">
              <DropdownField
                id="kanban-priority-filter-compact"
                ariaLabel="Filter tasks by priority"
                value={priorityFilter}
                onChange={(value) =>
                  setPriorityFilter(value as KanbanPriority | 'all')
                }
                options={PRIORITY_FILTERS}
                triggerClassName="h-11"
              />
            </div>
          </div>
        </div>

        <div className="hidden items-center gap-3 xl:flex">
          <div className="w-44 shrink-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">
                Work board
              </h1>
              {isBusy ? (
                <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-muted-foreground" />
              ) : null}
            </div>
            <p className="mt-0.5 whitespace-nowrap text-[11px] text-muted-foreground">
              {activeCardCount} active · {blockedCardCount} blocked ·{' '}
              {doneCardCount} done
            </p>
          </div>

          <div className="relative min-w-64 max-w-xl flex-1">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle-foreground"
            />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search tasks, labels, owners…"
              className="h-11 w-full rounded-xl border border-border bg-background pl-9 pr-9 text-sm text-foreground shadow-none placeholder:text-subtle-foreground focus:border-border focus:outline-none focus:ring-0 focus:shadow-none"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear task search"
                className="absolute right-1 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-muted hover:text-foreground"
              >
                <X size={14} />
              </button>
            ) : null}
          </div>

          <div className="w-44 shrink-0">
            <DropdownField
              id="kanban-priority-filter"
              ariaLabel="Filter tasks by priority"
              value={priorityFilter}
              onChange={(value) =>
                setPriorityFilter(value as KanbanPriority | 'all')
              }
              options={PRIORITY_FILTERS}
              triggerClassName="h-11"
            />
          </div>

          <div className="ml-auto flex items-center gap-2.5 shrink-0">
            {doneCardCount > 0 ? (
              <button
                type="button"
                onClick={() => void clearCompletedCards()}
                disabled={isBusy}
                className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border border-border bg-surface px-3.5 text-xs font-semibold leading-none text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:opacity-50"
              >
                <CheckCircle2 size={15} className="shrink-0" />
                <span className="leading-none">Clear done</span>
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => openComposer()}
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted"
            >
              <Plus size={16} />
              New task
            </button>
          </div>
        </div>
      </header>

      {isLoading ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-4 md:grid-cols-4 md:p-5">
          {KANBAN_COLUMNS.map((column) => (
            <div
              key={column.id}
              className="overflow-hidden rounded-2xl border border-border bg-surface-muted"
            >
              <header className="relative shrink-0 px-3.5 pb-2 pt-3.5">
                <div className="min-w-0 pr-12">
                  <div className="flex h-5 items-center gap-2 whitespace-nowrap">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${COLUMN_MARKER_CLASS_NAMES[column.id]}`}
                    />
                    <h2 className="shrink-0 text-xs font-bold uppercase leading-none tracking-[0.13em] text-foreground">
                      {column.title}
                    </h2>
                    <span className="invisible shrink-0 rounded-md bg-surface px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                      0
                    </span>
                  </div>
                  <p className="mt-1.5 line-clamp-1 text-[11px] text-subtle-foreground">
                    {column.description}
                  </p>
                </div>
              </header>
              <div className="space-y-2 px-2 pb-2">
                <div className="h-28 animate-pulse rounded-xl bg-surface" />
                <div className="h-24 animate-pulse rounded-xl bg-surface" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="hidden min-h-0 flex-1 overflow-x-auto p-4 md:block md:p-5">
            <div className="grid h-full min-w-[1080px] grid-cols-4 gap-3">
              {KANBAN_COLUMNS.map((column) => (
                <KanbanColumn
                  key={column.id}
                  cards={boardDisplayData.orderedCardsByColumn[column.id]}
                  cardMetaById={boardDisplayData.cardMetaById}
                  column={column}
                  count={columnCounts[column.id]}
                  draggedCardId={draggedCardId}
                  onAdd={(columnId) => openComposer(columnId)}
                  onCardOpen={setSelectedCardId}
                  onCardDragEnd={() => setDraggedCardId(null)}
                  onCardDragStart={setDraggedCardId}
                  onCardDropAt={(cardId, targetColumnId, targetIndex) => {
                    void reorderCard({
                      cardId,
                      targetColumnId,
                      targetIndex,
                    }).finally(() => setDraggedCardId(null))
                  }}
                  onCardMove={(cardId, targetColumnId) => {
                    void moveCard({ cardId, targetColumnId })
                  }}
                />
              ))}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:hidden">
            <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-surface px-3 py-2">
              {KANBAN_COLUMNS.map((column) => (
                <button
                  key={column.id}
                  type="button"
                  onClick={() => setMobileColumnId(column.id)}
                  className={[
                    'inline-flex h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-xs font-semibold transition-colors',
                    mobileColumnId === column.id
                      ? 'bg-action text-white'
                      : 'bg-surface text-muted-foreground',
                  ].join(' ')}
                >
                  {column.title}
                  <span className="tabular-nums opacity-75">
                    {columnCounts[column.id]}
                  </span>
                </button>
              ))}
            </nav>
            <div className="min-h-0 flex-1 p-3 pb-20">
              {KANBAN_COLUMNS.filter(
                (column) => column.id === mobileColumnId,
              ).map((column) => (
                <KanbanColumn
                  key={column.id}
                  cards={boardDisplayData.orderedCardsByColumn[column.id]}
                  cardMetaById={boardDisplayData.cardMetaById}
                  column={column}
                  count={columnCounts[column.id]}
                  draggedCardId={draggedCardId}
                  onAdd={(columnId) => openComposer(columnId)}
                  onCardOpen={setSelectedCardId}
                  onCardDragEnd={() => setDraggedCardId(null)}
                  onCardDragStart={setDraggedCardId}
                  onCardDropAt={(cardId, targetColumnId, targetIndex) => {
                    void reorderCard({ cardId, targetColumnId, targetIndex })
                  }}
                  onCardMove={(cardId, targetColumnId) => {
                    void moveCard({ cardId, targetColumnId })
                  }}
                />
              ))}
            </div>
            <div className="absolute bottom-0 left-0 right-0 z-20 border-t border-border bg-surface p-3">
              <button
                type="button"
                onClick={() => openComposer(mobileColumnId)}
                                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-action text-sm font-semibold text-white"
              >
                <Plus size={17} />
                Add to{' '}
                {
                  KANBAN_COLUMNS.find((column) => column.id === mobileColumnId)
                    ?.title
                }
              </button>
            </div>
          </div>
        </>
      )}

      {composerState ? (
        <KanbanTaskDialog
          initialColumnId={composerState.columnId}
          initialTitle={composerState.title}
          isAiPlanningEnabled={aiPlanner.isEnabled}
          isPlanning={aiPlanner.isPlanning}
          isSubmitting={isBusy}
          onClose={() => setComposerState(null)}
          onPlan={aiPlanner.planTask}
          onSubmit={(input) => {
            void handleCreateTask(input)
          }}
        />
      ) : null}

      {selectedCard ? (
        <KanbanTaskDetails
          key={selectedCard.id}
          card={selectedCard}
          cards={cards}
          isBusy={isBusy}
          onAddSubtask={addCard}
          onClose={() => setSelectedCardId(null)}
          onDelete={async (cardId, deleteSubtasks) => {
            const didDelete = await deleteCard({ cardId, deleteSubtasks })
            if (didDelete) {
              setSelectedCardId(null)
            }
          }}
          onMove={(cardId, targetColumnId) =>
            moveCard({ cardId, targetColumnId })
          }
          onOpenCard={setSelectedCardId}
          onUpdate={updateCard}
        />
      ) : null}

      {activeError ? (
        <KanbanErrorDialog
          error={activeError}
          onClose={dismissActiveError}
          onReviewTask={
            errorTask
              ? () => {
                  dismissActiveError()
                  setSelectedCardId(errorTask.id)
                }
              : undefined
          }
        />
      ) : null}
    </div>
  )
}
