import { GripVertical, Plus, Trash2 } from 'lucide-react'
import type { ClipboardEvent } from 'react'
import type { KanbanSubtaskDraft } from './kanbanTypes'

interface KanbanSubtaskDraftListProps {
  disabled?: boolean
  onChange: (subtasks: KanbanSubtaskDraft[]) => void
  subtasks: readonly KanbanSubtaskDraft[]
}

function createEmptySubtask(): KanbanSubtaskDraft {
  return {
    title: '',
  }
}

export function KanbanSubtaskDraftList({
  disabled = false,
  onChange,
  subtasks,
}: KanbanSubtaskDraftListProps) {
  function updateSubtask(index: number, title: string) {
    onChange(
      subtasks.map((subtask, currentIndex) =>
        currentIndex === index ? { ...subtask, title } : subtask,
      ),
    )
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>, index: number) {
    const pastedLines = event.clipboardData
      .getData('text')
      .split(/\r?\n/u)
      .map((line) => line.trim().replace(/^[-*]\s+/u, ''))
      .filter(Boolean)

    if (pastedLines.length < 2) {
      return
    }

    event.preventDefault()
    const nextSubtasks = [...subtasks]
    nextSubtasks.splice(
      index,
      1,
      ...pastedLines.map((title) => ({
        title,
      })),
    )
    onChange(nextSubtasks)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">Subtasks</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Break the work into clear steps now, or add them later.
          </p>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange([...subtasks, createEmptySubtask()])}
className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-foreground transition hover:-translate-y-px hover:bg-surface-muted active:translate-y-0 disabled:pointer-events-none disabled:opacity-50"
        >
          <Plus size={14} />
          Add subtask
        </button>
      </div>

      {subtasks.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-border bg-background">
          {subtasks.map((subtask, index) => (
            <div
              key={`subtask-draft-${index}`}
              className="flex min-h-12 items-center gap-2 border-b border-border-muted px-3 last:border-b-0"
            >
              <GripVertical
                size={14}
                className="shrink-0 text-subtle-foreground"
                aria-hidden="true"
              />
              <span className="w-5 shrink-0 text-right text-[11px] font-medium tabular-nums text-subtle-foreground">
                {index + 1}
              </span>
              <label className="sr-only" htmlFor={`kanban-subtask-${index}`}>
                Subtask {index + 1}
              </label>
              <input
                id={`kanban-subtask-${index}`}
                value={subtask.title}
                disabled={disabled}
                onChange={(event) => updateSubtask(index, event.target.value)}
                onPaste={(event) => handlePaste(event, index)}
                placeholder="Describe a concrete next step"
                className="h-11 min-w-0 flex-1 border-0 bg-transparent text-sm text-foreground shadow-none outline-none placeholder:text-subtle-foreground focus:border-0 focus:outline-none focus:ring-0 focus:shadow-none"
              />
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  onChange(
                    subtasks.filter(
                      (_, currentIndex) => currentIndex !== index,
                    ),
                  )
                }
                aria-label={`Remove subtask ${index + 1}`}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-danger-surface hover:text-danger-foreground disabled:pointer-events-none disabled:opacity-50"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange([createEmptySubtask()])}
          className="flex min-h-20 w-full items-center justify-center rounded-xl border border-dashed border-border bg-background px-4 text-sm text-muted-foreground transition-colors hover:border-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        >
          Add the first subtask
        </button>
      )}
    </div>
  )
}
