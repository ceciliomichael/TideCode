import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Plus, Save, X } from 'lucide-react'
import { PRIMARY_ACTION_BUTTON_CLASS_NAME } from '../shared/actionButtonStyles'
import type { CreateSkillInput } from '../../../types/skills'

interface SkillAddDialogProps {
  errorMessage: string | null
  initialValues?: CreateSkillInput
  isSubmitting: boolean
  mode?: 'add' | 'edit'
  onClose: () => void
  onSubmit: (input: CreateSkillInput) => Promise<boolean>
}

export function SkillAddDialog({
  errorMessage,
  initialValues,
  isSubmitting,
  mode = 'add',
  onClose,
  onSubmit,
}: SkillAddDialogProps) {
  const isEditing = mode === 'edit'
  const [name, setName] = useState(initialValues?.name ?? '')
  const [description, setDescription] = useState(initialValues?.description ?? '')
  const [content, setContent] = useState(initialValues?.content ?? '')
  const [validationError, setValidationError] = useState<string | null>(null)

  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  useEffect(() => {
    setName(initialValues?.name ?? '')
    setDescription(initialValues?.description ?? '')
    setContent(initialValues?.content ?? '')
    setValidationError(null)
  }, [initialValues])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isSubmitting) {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isSubmitting, onClose])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setValidationError(null)

    const trimmedName = name.trim()
    const trimmedDescription = description.trim()
    const trimmedContent = content.trim()

    if (!trimmedName) {
      setValidationError('Skill name is required.')
      return
    }

    if (!trimmedDescription) {
      setValidationError('Description is required.')
      return
    }

    if (!trimmedContent) {
      setValidationError('Instruction content is required.')
      return
    }

    const success = await onSubmit({
      content: trimmedContent,
      description: trimmedDescription,
      name: trimmedName,
    })

    if (success) {
      onClose()
    }
  }

  const activeError = validationError ?? errorMessage
  const dialogTitle = isEditing ? 'Edit Skill' : 'Add Skill'
  const dialogDescription = isEditing
    ? 'Update the reusable instructions and details for this skill.'
    : 'Create a new reusable instruction pack for the assistant.'

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 md:p-6">
      <div
        className="fixed inset-0 bg-black/60 transition-opacity"
        onClick={() => {
          if (!isSubmitting) onClose()
        }}
      />

      <div
        aria-labelledby="skill-dialog-title"
        aria-modal="true"
        className="relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl transition-all sm:max-h-[calc(100dvh-2rem)]"
        role="dialog"
      >
        <div className="flex items-start justify-between border-b border-border px-4 pb-4 pt-5 sm:px-6 sm:pt-6">
          <div>
            <h3 id="skill-dialog-title" className="text-base font-semibold text-foreground">
              {dialogTitle}
            </h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{dialogDescription}</p>
          </div>
          <button
            type="button"
            aria-label="Close skill dialog"
            onClick={onClose}
            disabled={isSubmitting}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg p-1 text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col space-y-4 overflow-y-auto p-4 sm:p-6">
            {activeError ? (
              <div className="rounded-xl border border-danger-border bg-danger-surface px-4 py-3 text-sm text-danger-foreground">
                {activeError}
              </div>
            ) : null}

            <div className="space-y-1.5">
              <label htmlFor="skill-name" className="text-sm font-medium text-foreground">
                Skill Name
              </label>
              <input
                id="skill-name"
                ref={nameRef}
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. writing, refactoring, unit-testing"
                disabled={isSubmitting}
                className="h-10 w-full rounded-xl border border-border bg-surface-muted px-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:outline-none focus:ring-0"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="skill-description" className="text-sm font-medium text-foreground">
                Description
              </label>
              <textarea
                id="skill-description"
                rows={5}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Brief summary of when and how this skill helps..."
                disabled={isSubmitting}
                className="w-full resize-none overflow-y-auto rounded-xl border border-border bg-surface-muted p-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:outline-none focus:ring-0"
              />
            </div>

            <div className="flex min-h-[240px] flex-1 flex-col space-y-1.5 sm:min-h-[320px]">
              <label htmlFor="skill-content" className="text-sm font-medium text-foreground">
                Instructions
              </label>
              <textarea
                id="skill-content"
                rows={14}
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder={`# Instructions for ${name || 'Skill'}\n\nSpecify workflow rules, guidelines, or formatting rules...`}
                disabled={isSubmitting}
                className="min-h-[220px] w-full flex-1 resize-none overflow-y-auto rounded-xl border border-border bg-surface-muted p-3 text-sm font-mono text-foreground placeholder:text-muted-foreground outline-none focus:outline-none focus:ring-0 sm:min-h-[300px]"
              />
            </div>
          </div>

          <div className="shrink-0 border-t border-border bg-surface px-4 py-4 sm:px-6">
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-border bg-surface-muted px-4 text-sm font-medium text-foreground transition-colors hover:bg-border-muted disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className={`${PRIMARY_ACTION_BUTTON_CLASS_NAME} h-10`}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {isEditing ? 'Saving...' : 'Creating...'}
                  </>
                ) : (
                  <>
                    {isEditing ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                    {isEditing ? 'Save Changes' : 'Add Skill'}
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
