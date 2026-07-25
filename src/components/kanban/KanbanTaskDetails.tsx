import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Check,
  CheckCircle2,
  Circle,
  ListTree,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { DropdownField, type DropdownOption } from '../ui/DropdownField'
import { KANBAN_COLUMNS } from './kanbanDefaults'
import {
  KANBAN_ISSUE_TYPE_OPTIONS,
  KANBAN_PRIORITY_OPTIONS,
} from './kanbanPresentation'
import { useKanbanTaskAutosave } from './useKanbanTaskAutosave'
import type {
  KanbanAcceptanceCriterion,
  KanbanCard,
  KanbanColumnId,
  KanbanCreateCardInput,
  KanbanIssueType,
  KanbanPriority,
  KanbanUpdateCardInput,
} from './kanbanTypes'

interface KanbanTaskDetailsProps {
  card: KanbanCard
  cards: readonly KanbanCard[]
  isBusy: boolean
  onAddSubtask: (input: KanbanCreateCardInput) => Promise<unknown>
  onClose: () => void
  onDelete: (cardId: string, deleteSubtasks: boolean) => Promise<void>
  onMove: (cardId: string, targetColumnId: KanbanColumnId) => Promise<unknown>
  onOpenCard: (cardId: string) => void
  onUpdate: (input: KanbanUpdateCardInput) => Promise<unknown>
}

function parseLabels(value: string) {
  return [
    ...new Set(
      value
        .split(',')
        .map((label) => label.trim())
        .filter(Boolean),
    ),
  ]
}

export function KanbanTaskDetails({
  card,
  cards,
  isBusy,
  onAddSubtask,
  onClose,
  onDelete,
  onMove,
  onOpenCard,
  onUpdate,
}: KanbanTaskDetailsProps) {
  const [title, setTitle] = useState(card.title)
  const [description, setDescription] = useState(card.description)
  const [columnId, setColumnId] = useState(card.columnId)
  const [priority, setPriority] = useState(card.priority)
  const [issueType, setIssueType] = useState(card.issueType)
  const [assignee, setAssignee] = useState(card.assignee ?? '')
  const [labels, setLabels] = useState(card.labels.join(', '))
  const [criteria, setCriteria] = useState<KanbanAcceptanceCriterion[]>(
    card.acceptanceCriteria,
  )
  const [newCriterion, setNewCriterion] = useState('')
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('')
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)

  const subtasks = useMemo(
    () =>
      cards
        .filter((candidate) => candidate.parentCardId === card.id)
        .sort((left, right) => left.position - right.position),
    [card.id, cards],
  )
  const isSubtask = card.parentCardId !== undefined
  const isDraftValid = title.trim().length > 0
  const columnOptions: readonly DropdownOption[] = KANBAN_COLUMNS.map(
    (column) => ({
      label: column.title,
      value: column.id,
    }),
  )
  const priorityOptions: readonly DropdownOption[] =
    KANBAN_PRIORITY_OPTIONS.map((option) => ({
      label: option.label,
      value: option.id,
    }))
  const issueTypeOptions: readonly DropdownOption[] =
    KANBAN_ISSUE_TYPE_OPTIONS.map((option) => ({
      label: option.label,
      value: option.id,
    }))

  const initialDraft = useMemo<KanbanUpdateCardInput>(
    () => ({
      acceptanceCriteria: card.acceptanceCriteria,
      assignee: card.assignee ?? null,
      cardId: card.id,
      columnId: card.columnId,
      description: card.description,
      issueType: card.issueType,
      labels: card.labels,
      parentCardId: card.parentCardId,
      priority: card.priority,
      title: card.title,
    }),
    [card],
  )
  const draft = useMemo<KanbanUpdateCardInput>(
    () => ({
      acceptanceCriteria: criteria,
      assignee: assignee.trim() || null,
      cardId: card.id,
      columnId,
      description,
      issueType,
      labels: parseLabels(labels),
      parentCardId: card.parentCardId,
      priority,
      title: title.trim(),
    }),
    [
      assignee,
      card.id,
      card.parentCardId,
      columnId,
      criteria,
      description,
      issueType,
      labels,
      priority,
      title,
    ],
  )
  const saveDraft = useCallback(
    async (nextDraft: KanbanUpdateCardInput) =>
      Boolean(await onUpdate(nextDraft)),
    [onUpdate],
  )
  const autosave = useKanbanTaskAutosave({
    draft,
    enabled: isDraftValid,
    initialDraft,
    onSave: saveDraft,
  })

  const handleClose = useCallback(async () => {
    if (autosave.status === 'unsaved' || autosave.status === 'saving') {
      const didSave = await autosave.flush()
      if (!didSave) {
        return
      }
    }
    onClose()
  }, [autosave, onClose])

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isBusy) {
        void handleClose()
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [handleClose, isBusy])

  async function handleAddSubtask() {
    const subtaskTitle = newSubtaskTitle.trim()
    if (!subtaskTitle || isBusy) {
      return
    }

    const result = await onAddSubtask({
      columnId: card.columnId === 'done' ? 'backlog' : card.columnId,
      parentCardId: card.id,
      title: subtaskTitle,
    })
    if (result) {
      setNewSubtaskTitle('')
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[1350] flex justify-end bg-black/16"
      style={{ top: 'env(titlebar-area-height, 0px)' }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isBusy) {
          void handleClose()
        }
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="kanban-details-title"
        className="flex h-full w-full flex-col border-l border-border bg-surface [&_input:focus]:!border-border [&_input:focus]:!shadow-none [&_input:focus]:!outline-none [&_input:focus]:!ring-0 [&_textarea:focus]:!border-border [&_textarea:focus]:!shadow-none [&_textarea:focus]:!outline-none [&_textarea:focus]:!ring-0 md:max-w-[620px]"
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border px-5 py-3 md:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <span className="rounded-md border border-border bg-surface-muted px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              {isSubtask ? 'Subtask' : issueType}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              Updated {new Date(card.updatedAt).toLocaleString()}
            </span>
          </div>
          <button
            type="button"
            aria-label="Close task details"
            disabled={isBusy}
            onClick={() => void handleClose()}
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-6">
          <div className="space-y-6">
            <section className="space-y-4">
              <label htmlFor="kanban-details-title" className="sr-only">
                Task title
              </label>
              <textarea
                id="kanban-details-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                rows={2}
                className="w-full resize-none bg-transparent text-2xl font-semibold leading-8 tracking-tight text-foreground focus:outline-none"
              />

              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <div className="space-y-1.5">
                  <label
                    htmlFor="kanban-details-status"
                    className="text-[11px] font-semibold text-muted-foreground"
                  >
                    Status
                  </label>
                  <DropdownField
                    id="kanban-details-status"
                    ariaLabel="Task status"
                    value={columnId}
                    onChange={(value) => setColumnId(value as KanbanColumnId)}
                    options={columnOptions}
                    triggerClassName="h-10"
                  />
                </div>
                <div className="space-y-1.5">
                  <label
                    htmlFor="kanban-details-priority"
                    className="text-[11px] font-semibold text-muted-foreground"
                  >
                    Priority
                  </label>
                  <DropdownField
                    id="kanban-details-priority"
                    ariaLabel="Task priority"
                    value={priority}
                    onChange={(value) => setPriority(value as KanbanPriority)}
                    options={priorityOptions}
                    triggerClassName="h-10"
                  />
                </div>
                <div className="col-span-2 space-y-1.5 md:col-span-1">
                  <label
                    htmlFor="kanban-details-type"
                    className="text-[11px] font-semibold text-muted-foreground"
                  >
                    Type
                  </label>
                  <DropdownField
                    id="kanban-details-type"
                    ariaLabel="Task type"
                    value={issueType}
                    onChange={(value) => setIssueType(value as KanbanIssueType)}
                    options={issueTypeOptions}
                    triggerClassName="h-10"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <label
                    htmlFor="kanban-details-owner"
                    className="text-[11px] font-semibold text-muted-foreground"
                  >
                    Owner
                  </label>
                  <input
                    id="kanban-details-owner"
                    value={assignee}
                    onChange={(event) => setAssignee(event.target.value)}
                    placeholder="Person or agent"
                    className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground shadow-none placeholder:text-subtle-foreground focus:border-border focus:outline-none focus:ring-0 focus:shadow-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label
                    htmlFor="kanban-details-labels"
                    className="text-[11px] font-semibold text-muted-foreground"
                  >
                    Labels
                  </label>
                  <input
                    id="kanban-details-labels"
                    value={labels}
                    onChange={(event) => setLabels(event.target.value)}
                    placeholder="frontend, reliability"
                    className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground shadow-none placeholder:text-subtle-foreground focus:border-border focus:outline-none focus:ring-0 focus:shadow-none"
                  />
                </div>
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                Context
              </h3>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Add context, constraints, and relevant decisions."
                rows={7}
                className="w-full resize-y rounded-xl border border-border bg-background px-4 py-3 text-sm leading-6 text-foreground shadow-none placeholder:text-subtle-foreground focus:border-border focus:outline-none focus:ring-0 focus:shadow-none"
              />
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-muted-foreground" />
                  <h3 className="text-sm font-semibold text-foreground">
                    Acceptance criteria
                  </h3>
                </div>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {criteria.filter((criterion) => criterion.completed).length}/
                  {criteria.length}
                </span>
              </div>
              {criteria.length > 0 ? (
                <div className="overflow-hidden rounded-xl border border-border bg-background">
                  {criteria.map((criterion) => (
                    <label
                      key={criterion.id}
                      className="flex min-h-11 cursor-pointer items-start gap-3 border-b border-border-muted px-3 py-2.5 last:border-b-0"
                    >
                      <input
                        type="checkbox"
                        checked={criterion.completed}
                        onChange={(event) =>
                          setCriteria((current) =>
                            current.map((item) =>
                              item.id === criterion.id
                                ? { ...item, completed: event.target.checked }
                                : item,
                            ),
                          )
                        }
                        className="sr-only"
                      />
                      <span
                        className={[
                          'mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border',
                          criterion.completed
                            ? 'border-action bg-action text-white'
                            : 'border-border bg-surface text-transparent',
                        ].join(' ')}
                      >
                        <Check size={12} />
                      </span>
                      <span
                        className={[
                          'text-sm leading-5',
                          criterion.completed
                            ? 'text-muted-foreground line-through'
                            : 'text-foreground',
                        ].join(' ')}
                      >
                        {criterion.text}
                      </span>
                    </label>
                  ))}
                </div>
              ) : null}
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  const text = newCriterion.trim()
                  if (!text) {
                    return
                  }
                  setCriteria((current) => [
                    ...current,
                    {
                      completed: false,
                      id: `${card.id}:criterion:draft:${Date.now()}`,
                      text,
                    },
                  ])
                  setNewCriterion('')
                }}
              >
                <input
                  value={newCriterion}
                  onChange={(event) => setNewCriterion(event.target.value)}
                  placeholder="Add a clear completion condition"
                  className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-sm text-foreground shadow-none placeholder:text-subtle-foreground focus:border-border focus:outline-none focus:ring-0 focus:shadow-none"
                />
                <button
                  type="submit"
                  disabled={!newCriterion.trim()}
                  aria-label="Add acceptance criterion"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-surface text-muted-foreground transition hover:bg-surface-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                >
                  <Plus size={16} />
                </button>
              </form>
            </section>

            {!isSubtask ? (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ListTree size={16} className="text-muted-foreground" />
                    <h3 className="text-sm font-semibold text-foreground">
                      Subtasks
                    </h3>
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {
                      subtasks.filter((subtask) => subtask.columnId === 'done')
                        .length
                    }
                    /{subtasks.length}
                  </span>
                </div>
                {subtasks.length > 0 ? (
                  <div className="overflow-hidden rounded-xl border border-border bg-background">
                    {subtasks.map((subtask) => {
                      const isDone = subtask.columnId === 'done'
                      return (
                        <div
                          key={subtask.id}
                          className="flex min-h-12 items-center gap-3 border-b border-border-muted px-3 last:border-b-0"
                        >
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() =>
                              void onMove(
                                subtask.id,
                                isDone ? 'in-progress' : 'done',
                              )
                            }
                            aria-label={
                              isDone
                                ? `Reopen ${subtask.title}`
                                : `Complete ${subtask.title}`
                            }
                            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:opacity-50"
                          >
                            {isDone ? (
                              <CheckCircle2 size={18} />
                            ) : (
                              <Circle size={18} />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenCard(subtask.id)}
                            className={[
                              'min-w-0 flex-1 truncate text-left text-sm',
                              isDone
                                ? 'text-muted-foreground line-through'
                                : 'text-foreground',
                            ].join(' ')}
                          >
                            {subtask.title}
                          </button>
                          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-subtle-foreground">
                            {
                              KANBAN_COLUMNS.find(
                                (column) => column.id === subtask.columnId,
                              )?.title
                            }
                          </span>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-border bg-background px-4 py-5 text-center text-sm text-muted-foreground">
                    No subtasks yet. Add the first concrete step below.
                  </div>
                )}
                <form
                  className="flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void handleAddSubtask()
                  }}
                >
                  <input
                    value={newSubtaskTitle}
                    onChange={(event) => setNewSubtaskTitle(event.target.value)}
                    placeholder="Add a subtask"
                    className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-sm text-foreground shadow-none placeholder:text-subtle-foreground focus:border-border focus:outline-none focus:ring-0 focus:shadow-none"
                  />
                  <button
                    type="submit"
                    disabled={!newSubtaskTitle.trim() || isBusy}
                    className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-foreground transition hover:bg-surface-muted disabled:pointer-events-none disabled:opacity-40"
                  >
                    <Plus size={15} />
                    Add
                  </button>
                </form>
              </section>
            ) : null}

            <section className="border-t border-border pt-5">
              {isConfirmingDelete ? (
                <div className="rounded-xl border border-danger-border bg-danger-surface p-4">
                  <p className="text-sm font-semibold text-danger-foreground">
                    Delete this task permanently?
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {subtasks.length > 0
                      ? `Its ${subtasks.length} subtask${subtasks.length === 1 ? '' : 's'} will also be deleted.`
                      : 'This action cannot be undone from the board.'}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => setIsConfirmingDelete(false)}
                      className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-foreground"
                    >
                      Keep task
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() =>
                        void onDelete(card.id, subtasks.length > 0)
                      }
                      className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-danger-border bg-danger-surface px-3 text-xs font-semibold text-danger-foreground"
                    >
                      <Trash2 size={14} />
                      Delete permanently
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => setIsConfirmingDelete(true)}
                  className="inline-flex h-11 items-center gap-2 rounded-xl text-sm font-semibold text-danger-foreground transition-colors hover:bg-danger-surface px-3 disabled:opacity-50"
                >
                  <Trash2 size={15} />
                  Delete task
                </button>
              )}
            </section>
          </div>
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-border bg-surface px-5 py-4 md:px-6">
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {!isDraftValid
              ? 'Add a title to save'
              : autosave.status === 'saving' || isBusy
                ? 'Saving…'
                : autosave.status === 'saved'
                  ? 'Saved'
                  : autosave.status === 'unsaved'
                    ? 'Waiting to save…'
                    : 'Changes save automatically'}
          </p>
          <button
            type="button"
            onClick={() => void handleClose()}
            disabled={isBusy}
            className="inline-flex h-11 flex-1 items-center justify-center rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-foreground transition-colors hover:bg-surface-muted disabled:opacity-50 md:flex-none"
          >
            Close
          </button>
        </footer>
      </aside>
    </div>,
    document.body,
  )
}
