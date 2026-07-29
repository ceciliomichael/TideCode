import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'

interface InlineEditableTitleProps {
  value: string
  onSave: (nextValue: string) => void | Promise<void>
}

export function InlineEditableTitle({ value, onSave }: InlineEditableTitleProps) {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [draftValue, setDraftValue] = useState(value)
  const [optimisticValue, setOptimisticValue] = useState<string | null>(null)

  const renderedValue = optimisticValue ?? value

  useEffect(() => {
    if (isEditing) {
      return
    }

    setDraftValue(renderedValue)
  }, [isEditing, renderedValue])

  useEffect(() => {
    if (optimisticValue !== null && optimisticValue === value) {
      setOptimisticValue(null)
    }
  }, [optimisticValue, value])

  useEffect(() => {
    if (!isEditing) {
      return
    }

    const element = inputRef.current
    if (!element) {
      return
    }

    element.focus()
    const length = element.value.length
    requestAnimationFrame(() => {
      element.setSelectionRange(length, length)
    })
  }, [isEditing])

  async function commitSave() {
    const nextValue = draftValue.trim()
    setIsEditing(false)

    if (nextValue.length === 0 || nextValue === renderedValue) {
      setDraftValue(renderedValue)
      return
    }

    setOptimisticValue(nextValue)

    try {
      await onSave(nextValue)
    } catch {
      setOptimisticValue(null)
      setDraftValue(value)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      void commitSave()
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      setDraftValue(renderedValue)
      setOptimisticValue(null)
      setIsEditing(false)
    }
  }

  if (isEditing) {
    return (
      <div className="flex min-h-10 min-w-0 flex-1 items-center">
        <label htmlFor={inputId} className="sr-only">
          Thread title
        </label>
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          value={draftValue}
          onChange={(event) => setDraftValue(event.target.value)}
          onBlur={() => void commitSave()}
          onKeyDown={handleKeyDown}
          className="w-full bg-transparent text-sm font-semibold text-foreground outline-none"
        />
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setIsEditing(true)}
      className="flex min-h-10 min-w-0 items-center text-left"
      aria-label="Rename thread"
    >
      <span className="block truncate text-sm font-semibold text-foreground transition-colors hover:text-foreground/80">
        {renderedValue}
      </span>
    </button>
  )
}
