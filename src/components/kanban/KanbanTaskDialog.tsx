import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bot, CheckSquare2, X } from 'lucide-react'
import { DropdownField, type DropdownOption } from '../ui/DropdownField'
import { KANBAN_COLUMNS } from './kanbanDefaults'
import {
  KANBAN_ISSUE_TYPE_OPTIONS,
  KANBAN_PRIORITY_OPTIONS,
} from './kanbanPresentation'
import { KanbanSubtaskDraftList } from './KanbanSubtaskDraftList'
import type {
  KanbanColumnId,
  KanbanCreateTaskInput,
  KanbanIssueType,
  KanbanPriority,
  KanbanSubtaskDraft,
} from './kanbanTypes'

interface KanbanTaskDialogProps {
  initialColumnId?: KanbanColumnId
  initialTitle?: string
  isAiPlanningEnabled?: boolean
  isPlanning?: boolean
  isSubmitting?: boolean
  onClose: () => void
  onPlan?: (
    title: string,
    description: string,
  ) => Promise<import('../../lib/kanban').KanbanTaskPlan | null>
  onSubmit: (input: KanbanCreateTaskInput) => void
}

function splitCommaSeparatedValues(value: string) {
  return [
    ...new Set(
      value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ]
}

export function KanbanTaskDialog({
  initialColumnId = 'backlog',
  initialTitle = '',
  isAiPlanningEnabled = false,
  isPlanning = false,
  isSubmitting = false,
  onClose,
  onPlan,
  onSubmit,
}: KanbanTaskDialogProps) {
  const [title, setTitle] = useState(initialTitle)
  const [description, setDescription] = useState('')
  const [columnId, setColumnId] = useState<KanbanColumnId>(initialColumnId)
  const [priority, setPriority] = useState<KanbanPriority>('none')
  const [issueType, setIssueType] = useState<KanbanIssueType>('task')
  const [assignee, setAssignee] = useState('')
  const [labels, setLabels] = useState('')
  const [criteriaText, setCriteriaText] = useState('')
  const [subtasks, setSubtasks] = useState<KanbanSubtaskDraft[]>([])

  useEffect(() => {
    setTitle(initialTitle)
    setColumnId(initialColumnId)
  }, [initialColumnId, initialTitle])

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isSubmitting) {
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isSubmitting, onClose])

  const columnOptions = useMemo<readonly DropdownOption[]>(
    () =>
      KANBAN_COLUMNS.map((column) => ({
        label: column.title,
        value: column.id,
      })),
    [],
  )
  const priorityOptions = useMemo<readonly DropdownOption[]>(
    () =>
      KANBAN_PRIORITY_OPTIONS.map((option) => ({
        label: option.label,
        value: option.id,
      })),
    [],
  )
  const issueTypeOptions = useMemo<readonly DropdownOption[]>(
    () =>
      KANBAN_ISSUE_TYPE_OPTIONS.map((option) => ({
        label: option.label,
        value: option.id,
      })),
    [],
  )
  const validSubtasks = subtasks.filter(
    (subtask) => subtask.title.trim().length > 0,
  )
  const canSubmit = title.trim().length > 0 && !isSubmitting

  return createPortal(
    <div
            className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/20 p-3 sm:p-4 md:p-5"
      style={{ top: 'env(titlebar-area-height, 0px)' }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) {
          onClose()
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="kanban-task-dialog-title"
                className="non-selectable-ui flex h-[min(760px,calc(100dvh-1.5rem))] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-surface [&_input:focus]:!border-border [&_input:focus]:!shadow-none [&_input:focus]:!outline-none [&_input:focus]:!ring-0 [&_textarea:focus]:!border-border [&_textarea:focus]:!shadow-none [&_textarea:focus]:!outline-none [&_textarea:focus]:!ring-0 [&_*:focus-visible]:outline-none [&_*:focus-visible]:ring-0 sm:h-[min(760px,calc(100dvh-2rem))] md:h-[min(760px,calc(100dvh-3rem))]"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-5 py-4 md:px-7 md:py-5">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              New work item
            </p>
            <h2
              id="kanban-task-dialog-title"
              className="mt-0.5 text-xl font-semibold tracking-tight text-foreground"
            >
              Shape the work before it starts
            </h2>
            <p className="mt-1 hidden text-sm text-muted-foreground md:block">
              Give people and agents enough context to finish confidently.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close task composer"
            onClick={onClose}
            disabled={isSubmitting}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </header>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault()
            if (!canSubmit) {
              return
            }

            onSubmit({
              acceptanceCriteria: criteriaText
                .split(/\r?\n/u)
                .map((text) => text.trim().replace(/^[-*]\s+/u, ''))
                .filter(Boolean)
                .map((text) => ({ text })),
              assignee: assignee.trim() || undefined,
              columnId,
              description: description.trim(),
              issueType,
              labels: splitCommaSeparatedValues(labels),
              priority,
              subtasks: validSubtasks.map((subtask) => ({
                ...subtask,
                title: subtask.title.trim(),
              })),
              title: title.trim(),
            })
          }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-7">
            <div className="grid gap-6 md:grid-cols-[minmax(0,1.55fr)_minmax(240px,0.75fr)]">
              <div className="space-y-5">
                <div className="space-y-2">
                                    <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                    <label
                      htmlFor="kanban-task-title"
                      className="text-sm font-semibold text-foreground"
                    >
                      What needs to happen?
                    </label>
                    {isAiPlanningEnabled && onPlan ? (
                      <button
                        type="button"
                        disabled={!title.trim() || isPlanning || isSubmitting}
                        onClick={() => {
                          void onPlan(title, description).then((plan) => {
                            if (!plan) {
                              return
                            }
                            if (plan.description) {
                              setDescription(plan.description)
                            }
                            setCriteriaText(plan.acceptanceCriteria.join('\n'))
                            setLabels(plan.labels.join(', '))
                            setSubtasks(
                              plan.subtasks.map((subtaskTitle) => ({
                                title: subtaskTitle,
                              })),
                            )
                          })
                        }}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-foreground transition hover:-translate-y-px hover:bg-surface-muted active:translate-y-0 disabled:pointer-events-none disabled:opacity-40"
                      >
                        <Bot size={14} />
                        {isPlanning ? 'Planning…' : 'Plan with AI'}
                      </button>
                    ) : null}
                  </div>
                  <input
                    id="kanban-task-title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="A short, outcome-focused title"
                    autoFocus
                    className="h-12 w-full rounded-xl border border-border bg-background px-4 text-base font-medium text-foreground shadow-none placeholder:font-normal placeholder:text-subtle-foreground focus:border-border focus:outline-none focus:ring-0 focus:shadow-none"
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="kanban-task-description"
                    className="text-sm font-semibold text-foreground"
                  >
                    Context
                  </label>
                  <textarea
                    id="kanban-task-description"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Explain the goal, relevant decisions, constraints, and what a good result looks like."
                    rows={6}
                    className="w-full resize-y rounded-xl border border-border bg-background px-4 py-3 text-sm leading-6 text-foreground shadow-none placeholder:text-subtle-foreground focus:border-border focus:outline-none focus:ring-0 focus:shadow-none"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <CheckSquare2 size={15} className="text-muted-foreground" />
                    <label
                      htmlFor="kanban-task-criteria"
                      className="text-sm font-semibold text-foreground"
                    >
                      Acceptance criteria
                    </label>
                  </div>
                  <textarea
                    id="kanban-task-criteria"
                    value={criteriaText}
                    onChange={(event) => setCriteriaText(event.target.value)}
                    placeholder={
                      'One clear outcome per line\nKeyboard navigation works\nFailures are visible and retryable'
                    }
                    rows={4}
                    className="w-full resize-y rounded-xl border border-border bg-background px-4 py-3 text-sm leading-6 text-foreground shadow-none placeholder:text-subtle-foreground focus:border-border focus:outline-none focus:ring-0 focus:shadow-none"
                  />
                </div>

                <KanbanSubtaskDraftList
                  disabled={isSubmitting}
                  subtasks={subtasks}
                  onChange={setSubtasks}
                />
              </div>

              <aside className="space-y-4 md:border-l md:border-border md:pl-6">
                <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">
                  Planning details
                </p>
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-1">
                  <div className="space-y-2">
                    <label
                      htmlFor="kanban-task-type"
                      className="text-xs font-semibold text-muted-foreground"
                    >
                      Type
                    </label>
                    <DropdownField
                      id="kanban-task-type"
                      ariaLabel="Task type"
                      value={issueType}
                      onChange={(value) =>
                        setIssueType(value as KanbanIssueType)
                      }
                      options={issueTypeOptions}
                      triggerClassName="h-11"
                    />
                  </div>
                  <div className="space-y-2">
                    <label
                      htmlFor="kanban-task-status"
                      className="text-xs font-semibold text-muted-foreground"
                    >
                      Status
                    </label>
                    <DropdownField
                      id="kanban-task-status"
                      ariaLabel="Task status"
                      value={columnId}
                      onChange={(value) => setColumnId(value as KanbanColumnId)}
                      options={columnOptions}
                      triggerClassName="h-11"
                    />
                  </div>
                  <div className="space-y-2">
                    <label
                      htmlFor="kanban-task-priority"
                      className="text-xs font-semibold text-muted-foreground"
                    >
                      Priority
                    </label>
                    <DropdownField
                      id="kanban-task-priority"
                      ariaLabel="Task priority"
                      value={priority}
                      onChange={(value) => setPriority(value as KanbanPriority)}
                      options={priorityOptions}
                      triggerClassName="h-11"
                    />
                  </div>
                  <div className="space-y-2">
                    <label
                      htmlFor="kanban-task-assignee"
                      className="text-xs font-semibold text-muted-foreground"
                    >
                      Owner
                    </label>
                    <input
                      id="kanban-task-assignee"
                      value={assignee}
                      onChange={(event) => setAssignee(event.target.value)}
                      placeholder="Person or agent"
                      className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground shadow-none placeholder:text-subtle-foreground focus:border-border focus:outline-none focus:ring-0 focus:shadow-none"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="kanban-task-labels"
                    className="text-xs font-semibold text-muted-foreground"
                  >
                    Labels
                  </label>
                  <input
                    id="kanban-task-labels"
                    value={labels}
                    onChange={(event) => setLabels(event.target.value)}
                    placeholder="frontend, reliability"
                    className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground shadow-none placeholder:text-subtle-foreground focus:border-border focus:outline-none focus:ring-0 focus:shadow-none"
                  />
                  <p className="text-[11px] leading-4 text-subtle-foreground">
                    Separate labels with commas.
                  </p>
                </div>
              </aside>
            </div>
          </div>

          <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-surface px-5 py-4 md:px-7">
            <p className="hidden text-xs text-muted-foreground md:block">
              {validSubtasks.length > 0
                ? `${validSubtasks.length} subtask${validSubtasks.length === 1 ? '' : 's'} will be created with this task.`
                : 'You can add subtasks now or from task details later.'}
            </p>
            <div className="ml-auto flex w-full items-center gap-2 md:w-auto">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="inline-flex h-11 flex-1 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-medium text-foreground transition hover:bg-surface-muted active:scale-[0.99] disabled:opacity-50 md:flex-none"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                className={[
                  'inline-flex h-11 flex-[1.4] items-center justify-center rounded-xl px-5 text-sm font-medium transition active:scale-[0.99] md:flex-none',
                  canSubmit
                    ? 'chat-send-button-enabled cursor-pointer'
                    : 'chat-send-button-disabled cursor-not-allowed',
                ].join(' ')}
              >
                {isSubmitting ? 'Creating…' : 'Create task'}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>,
    document.body,
  )
}
