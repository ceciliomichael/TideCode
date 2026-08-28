import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Save, X } from 'lucide-react'
import type { ReasoningEffort } from '../../../types/chat'
import { resolveReasoningEffortTransition } from '../../../lib/reasoningEffortTransition'
import { ModelSelectorField, type ModelSelectorOption } from '../../chat/ModelSelectorField'
import { ReasoningEffortBlock } from '../../chat/ReasoningEffortBlock'
import { PRIMARY_ACTION_BUTTON_CLASS_NAME } from '../shared/actionButtonStyles'

export interface TaskModelConfigurationOption extends ModelSelectorOption {
  defaultReasoningEffort?: ReasoningEffort
  reasoningEfforts?: readonly ReasoningEffort[]
}

interface TaskModelConfigurationDialogProps {
  description: string
  initialModelValue: string
  initialReasoningEffort: ReasoningEffort
  isSubmitting: boolean
  onClose: () => void
  onSave: (input: { modelValue: string; reasoningEffort: ReasoningEffort }) => void
  options: readonly TaskModelConfigurationOption[]
  title: string
}

export function TaskModelConfigurationDialog({
  description,
  initialModelValue,
  initialReasoningEffort,
  isSubmitting,
  onClose,
  onSave,
  options,
  title,
}: TaskModelConfigurationDialogProps) {
  const [modelValue, setModelValue] = useState(initialModelValue)
  const [reasoningEffort, setReasoningEffort] = useState(initialReasoningEffort)
  const selectedOption = useMemo(
    () => options.find((option) => option.value === modelValue) ?? options[0] ?? null,
    [modelValue, options],
  )
  const displayedReasoningEffort = selectedOption?.reasoningEfforts?.length
    ? resolveReasoningEffortTransition({
        currentEffort: reasoningEffort,
        defaultEffort: selectedOption.defaultReasoningEffort,
        supportedEfforts: selectedOption.reasoningEfforts,
      })
    : reasoningEffort

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isSubmitting) onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isSubmitting, onClose])

  function handleModelChange(nextValue: string) {
    setModelValue(nextValue)
    const nextOption = options.find((option) => option.value === nextValue)
    if (!nextOption?.reasoningEfforts?.length) return
    setReasoningEffort((currentEffort) =>
      resolveReasoningEffortTransition({
        currentEffort,
        defaultEffort: nextOption.defaultReasoningEffort,
        supportedEfforts: nextOption.reasoningEfforts,
      }),
    )
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSave({ modelValue, reasoningEffort: displayedReasoningEffort })
    onClose()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-3 sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-model-configuration-dialog-title"
        className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-soft sm:max-h-[calc(100dvh-2rem)]"
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-4 py-4 md:px-6">
          <div className="min-w-0">
            <h2 id="task-model-configuration-dialog-title" className="text-lg font-semibold text-foreground">{title}</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
          </div>
          <button
            type="button"
            aria-label="Close configuration dialog"
            onClick={onClose}
            disabled={isSubmitting}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-surface-muted hover:text-foreground disabled:opacity-50 md:h-9 md:w-9"
          >
            <X size={18} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5 md:px-6">
            <div
              className={selectedOption?.reasoningEfforts?.length
                ? 'grid gap-4 sm:grid-cols-2'
                : 'grid gap-4'}
            >
              <div className="min-w-0 space-y-2">
                <p className="text-sm font-medium text-foreground">Model</p>
                <ModelSelectorField
                  className="w-full"
                  disabled={isSubmitting}
                  fullWidth
                  options={options}
                  triggerClassName="min-h-10 w-full justify-start px-3 py-2 text-sm text-foreground"
                  value={modelValue}
                  onChange={handleModelChange}
                />
              </div>

              {selectedOption?.reasoningEfforts?.length ? (
                <div className="min-w-0 space-y-2">
                  <p className="text-sm font-medium text-foreground">Default reasoning effort</p>
                  <ReasoningEffortBlock
                    disabled={isSubmitting}
                    fullWidth
                    options={selectedOption.reasoningEfforts}
                    triggerClassName="min-h-10 justify-start px-3 py-2 text-sm text-foreground"
                    value={displayedReasoningEffort}
                    onChange={setReasoningEffort}
                  />
                </div>
              ) : null}
            </div>

            {selectedOption?.reasoningEfforts?.length ? (
              <p className="text-xs leading-5 text-muted-foreground">
                Used whenever this configured model starts the workflow. Chat-level model changes remain conversation-specific.
              </p>
            ) : null}
          </div>

          <footer className="flex flex-col-reverse gap-2 border-t border-border bg-surface px-4 py-4 sm:flex-row sm:justify-end md:px-6">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="h-11 rounded-xl border border-border bg-surface px-4 text-sm font-medium text-foreground hover:bg-surface-muted disabled:opacity-50 md:h-10"
            >
              Cancel
            </button>
            <button type="submit" disabled={isSubmitting} className={`${PRIMARY_ACTION_BUTTON_CLASS_NAME} h-11 md:h-10`}>
              <Save size={15} />
              Save changes
            </button>
          </footer>
        </form>
      </div>
    </div>,
    document.body,
  )
}
