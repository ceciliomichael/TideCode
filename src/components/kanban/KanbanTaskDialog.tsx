import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Trash2, X } from 'lucide-react'
import type { KanbanColumnId, KanbanCreateCardInput } from './kanbanTypes'
import { KANBAN_COLUMNS } from './kanbanDefaults'
import { DropdownField, type DropdownOption } from '../ui/DropdownField'

interface KanbanTaskDialogProps {
  dialogTitle: string
  initialDescription?: string
  initialParentCardId?: string
  initialTitle?: string
  initialColumnId?: KanbanColumnId
  isSubmitting?: boolean
  onDelete?: () => void
  parentOptions: readonly DropdownOption[]
  submitLabel: string
  onClose: () => void
  onSubmit: (input: KanbanCreateCardInput) => void
}

export function KanbanTaskDialog({
  dialogTitle,
  initialDescription = '',
  initialParentCardId,
  initialTitle = '',
  initialColumnId = 'backlog',
  isSubmitting = false,
  onDelete,
  parentOptions,
  submitLabel,
  onClose,
  onSubmit,
}: KanbanTaskDialogProps) {
  const [title, setTitle] = useState(initialTitle)
  const [description, setDescription] = useState(initialDescription)
  const [columnId, setColumnId] = useState<KanbanColumnId>(initialColumnId)
  const [parentCardId, setParentCardId] = useState(initialParentCardId ?? '')

  useEffect(() => {
    setTitle(initialTitle)
    setDescription(initialDescription)
    setColumnId(initialColumnId)
    setParentCardId(initialParentCardId ?? '')
  }, [initialColumnId, initialDescription, initialParentCardId, initialTitle])

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isSubmitting) {
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isSubmitting, onClose])

  const canSubmit = title.trim().length > 0
  const columnOptions = useMemo(
    () => KANBAN_COLUMNS.map((column) => ({ id: column.id, label: column.title })),
    [],
  )
  const parentTaskOptions = useMemo<readonly DropdownOption[]>(
    () => [{ label: 'No parent task', value: '' }, ...parentOptions],
    [parentOptions],
  )
  const dropdownOptions = useMemo<readonly DropdownOption[]>(
    () => columnOptions.map((option) => ({ label: option.label, value: option.id })),
    [columnOptions],
  )

  return createPortal(
    <div
      className="fixed inset-0 z-[1400] flex items-center justify-center bg-black/12 px-4 py-4"
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
        className="flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-soft"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 pt-5 pb-4 md:px-6">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-subtle-foreground">Task details</p>
            <h2 id="kanban-task-dialog-title" className="mt-1 text-lg font-semibold text-foreground">
              {dialogTitle}
            </h2>
          </div>

          <button
            type="button"
            aria-label="Close task dialog"
            onClick={onClose}
            disabled={isSubmitting}
            className="inline-flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        <form
          className="space-y-4 px-5 py-5 md:px-6"
          onSubmit={(event) => {
            event.preventDefault()
            if (!canSubmit) {
              return
            }

            onSubmit({
              columnId,
              description: description.trim(),
              parentCardId: parentCardId.trim().length > 0 ? parentCardId.trim() : null,
              title: title.trim(),
            })
          }}
        >
          <div className="space-y-2">
            <label htmlFor="kanban-task-title" className="text-sm font-medium text-foreground">
              Task title
            </label>
            <input
              id="kanban-task-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Write a short task title"
              autoFocus
              className="h-11 w-full rounded-xl border border-border bg-background px-4 text-sm text-foreground placeholder:text-subtle-foreground focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="kanban-task-description" className="text-sm font-medium text-foreground">
              Task details
            </label>
            <textarea
              id="kanban-task-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Add context, notes, or a clear next step"
              rows={6}
              className="w-full resize-none rounded-xl border border-border bg-background px-4 py-3 text-sm leading-6 text-foreground placeholder:text-subtle-foreground focus:outline-none"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="kanban-task-parent" className="text-sm font-medium text-foreground">
              Parent task
            </label>
            <DropdownField
              id="kanban-task-parent"
              ariaLabel="Parent task"
              value={parentCardId}
              onChange={(value) => setParentCardId(value)}
              options={parentTaskOptions}
              triggerClassName="h-11"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="kanban-task-column" className="text-sm font-medium text-foreground">
              Column
            </label>
            <DropdownField
              id="kanban-task-column"
              ariaLabel="Task column"
              value={columnId}
              onChange={(value) => setColumnId(value as KanbanColumnId)}
              options={dropdownOptions}
              triggerClassName="h-11"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
            {onDelete ? (
              <button
                type="button"
                onClick={onDelete}
                disabled={isSubmitting}
                className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-danger-border bg-danger-surface px-4 text-sm font-medium text-danger-foreground transition-colors hover:text-danger-foreground-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Trash2 size={13} />
                Delete
              </button>
            ) : (
              <span />
            )}
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-border bg-surface px-4 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmit || isSubmitting}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-border bg-surface px-4 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitLabel}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
