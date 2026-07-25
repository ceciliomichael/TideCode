import { useCallback, useEffect, useRef, useState } from 'react'
import type { KanbanUpdateCardInput } from './kanbanTypes'

export type KanbanAutosaveStatus = 'idle' | 'saving' | 'saved' | 'unsaved'

interface UseKanbanTaskAutosaveInput {
  draft: KanbanUpdateCardInput
  enabled: boolean
  initialDraft: KanbanUpdateCardInput
  onSave: (draft: KanbanUpdateCardInput) => Promise<boolean>
}

function fingerprintDraft(draft: KanbanUpdateCardInput) {
  return JSON.stringify(draft)
}

export function useKanbanTaskAutosave({
  draft,
  enabled,
  initialDraft,
  onSave,
}: UseKanbanTaskAutosaveInput) {
  const latestDraftRef = useRef(draft)
  const savedFingerprintRef = useRef(fingerprintDraft(initialDraft))
  const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true))
  const [status, setStatus] = useState<KanbanAutosaveStatus>('idle')
  const draftFingerprint = fingerprintDraft(draft)

  latestDraftRef.current = draft

  const flush = useCallback(() => {
    if (!enabled) {
      setStatus('unsaved')
      return Promise.resolve(false)
    }

    const requestedDraft = latestDraftRef.current
    const requestedFingerprint = fingerprintDraft(requestedDraft)
    if (requestedFingerprint === savedFingerprintRef.current) {
      setStatus('saved')
      return saveQueueRef.current
    }

    const queuedSave = saveQueueRef.current.then(async () => {
      setStatus('saving')
      const didSave = await onSave(requestedDraft)
      if (didSave) {
        savedFingerprintRef.current = requestedFingerprint
      }

      const latestFingerprint = fingerprintDraft(latestDraftRef.current)
      setStatus(
        didSave && latestFingerprint === requestedFingerprint
          ? 'saved'
          : 'unsaved',
      )
      return didSave
    })

    saveQueueRef.current = queuedSave.catch(() => {
      setStatus('unsaved')
      return false
    })
    return saveQueueRef.current
  }, [enabled, onSave])

  useEffect(() => {
    if (!enabled || draftFingerprint === savedFingerprintRef.current) {
      return
    }

    setStatus('unsaved')
    const timeoutId = window.setTimeout(() => {
      void flush()
    }, 600)
    return () => window.clearTimeout(timeoutId)
  }, [draftFingerprint, enabled, flush])

  return {
    flush,
    status,
  }
}
