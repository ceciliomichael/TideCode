import { useMemo, useState, type FormEvent } from 'react'
import { CheckCircle2, ListPlus } from 'lucide-react'
import type { Message } from '../../types/chat'
import { KANBAN_COLUMNS } from './kanbanDefaults'
import { KanbanColumn } from './KanbanColumn'
import { KanbanTaskDialog } from './KanbanTaskDialog'
import type { KanbanCard, KanbanColumnId, KanbanCreateCardInput } from './kanbanTypes'
import { useKanbanBoardState } from './useKanbanBoardState'

interface KanbanBoardProps {
  workspacePath: string | null
  messages: readonly Message[]
}

interface TaskDraftState {
  description: string
  mode: 'create' | 'edit'
  cardId?: string
  columnId: KanbanColumnId
  title: string
}

export function KanbanBoard({ workspacePath, messages }: KanbanBoardProps) {
  const [draftTitle, setDraftTitle] = useState('')
  const [draftTask, setDraftTask] = useState<TaskDraftState | null>(null)
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null)
  const {
    addCard,
    cards,
    clearCompletedCards,
    deleteCard,
    moveCard,
    updateCard,
  } =
    useKanbanBoardState({
      workspacePath,
      messages,
    })

  const doneCardCount = useMemo(() => cards.filter((card) => card.columnId === 'done').length, [cards])
  const columnCounts = useMemo(
    () =>
      KANBAN_COLUMNS.reduce(
        (accumulator, column) => {
          accumulator[column.id] = cards.filter((card) => card.columnId === column.id).length
          return accumulator
        },
        {} as Record<KanbanColumnId, number>,
      ),
    [cards],
  )

  function openTaskDialog() {
    setDraftTask({
      columnId: 'backlog',
      description: '',
      mode: 'create',
      title: draftTitle.trim(),
    })
  }

  function handleAddCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    openTaskDialog()
  }

  function handleMoveCard(cardId: string, targetColumnId: KanbanColumnId) {
    moveCard({ cardId, targetColumnId })
    setDraggedCardId(null)
  }

  function handleSubmitTask(input: KanbanCreateCardInput) {
    if (draftTask?.mode === 'edit' && draftTask.cardId) {
      updateCard({
        cardId: draftTask.cardId,
        columnId: input.columnId ?? 'backlog',
        description: input.description ?? '',
        title: input.title,
      })
    } else {
      addCard(input)
    }

    setDraftTitle('')
    setDraftTask(null)
  }

  function handleOpenCard(card: KanbanCard) {
    setDraftTask({
      cardId: card.id,
      columnId: card.columnId,
      description: card.description,
      mode: 'edit',
      title: card.title,
    })
  }

  function handleDeleteTask() {
    if (!draftTask?.cardId) {
      return
    }

    deleteCard({ cardId: draftTask.cardId })
    setDraftTask(null)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-surface px-4 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="text-xs text-subtle-foreground">{cards.length} tasks</span>
          {doneCardCount > 0 ? <span className="text-xs text-subtle-foreground">· {doneCardCount} done</span> : null}
        </div>

        <form onSubmit={handleAddCard} className="flex items-center gap-1.5">
          <label className="sr-only" htmlFor="kanban-card-title">
            Task title
          </label>
          <input
            id="kanban-card-title"
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            placeholder="New task title"
            className="h-8 w-56 rounded-lg border border-border bg-surface px-3 text-xs text-foreground placeholder:text-subtle-foreground focus:outline-none"
          />
          <button
            type="submit"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-muted disabled:pointer-events-none disabled:opacity-40"
          >
            <ListPlus size={13} />
            Add
          </button>
        </form>

        {doneCardCount > 0 ? (
          <button
            type="button"
            onClick={clearCompletedCards}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
          >
            <CheckCircle2 size={13} />
            Clear done
          </button>
        ) : null}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-4 divide-x divide-border overflow-hidden">
        {KANBAN_COLUMNS.map((column) => (
          <KanbanColumn
            key={column.id}
            cards={cards.filter((card) => card.columnId === column.id)}
            column={column}
            draggedCardId={draggedCardId}
            count={columnCounts[column.id]}
            onCardOpen={(cardId) => {
              const card = cards.find((currentCard) => currentCard.id === cardId)
              if (card) {
                handleOpenCard(card)
              }
            }}
            onCardDragStart={setDraggedCardId}
            onCardDrop={handleMoveCard}
            onCardMove={handleMoveCard}
          />
        ))}
      </div>

      {draftTask ? (
        <KanbanTaskDialog
          dialogTitle={draftTask.mode === 'edit' ? 'Edit task' : 'Describe what this task is about'}
          initialColumnId={draftTask.columnId}
          initialDescription={draftTask.description}
          initialTitle={draftTask.title}
          onDelete={draftTask.mode === 'edit' ? handleDeleteTask : undefined}
          submitLabel={draftTask.mode === 'edit' ? 'Save changes' : 'Add task'}
          onClose={() => setDraftTask(null)}
          onSubmit={handleSubmitTask}
        />
      ) : null}
    </div>
  )
}
