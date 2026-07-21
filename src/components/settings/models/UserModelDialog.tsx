import { Check, Loader2, Save, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { DropdownField } from '../../ui/DropdownField'
import { LineNumberedTextarea } from '../shared/LineNumberedTextarea'
import { PRIMARY_ACTION_BUTTON_CLASS_NAME } from '../shared/actionButtonStyles'
import { formatModelExtraBody, parseModelExtraBodyText } from './modelExtraBody'
import {
  buildUserModelReasoningProfile,
  getSelectableUserModelEfforts,
  getUserModelReasoningKind,
  type UserModelReasoningKind,
} from '../../../lib/userModelReasoning'
import type {
  CustomModelConfig,
  CustomModelProviderId,
  ReasoningEffort,
  SaveCustomModelInput,
} from '../../../types/chat'

export interface UserModelProviderOption {
  label: string
  value: CustomModelProviderId
}

interface UserModelDialogProps {
  initialProviderId: CustomModelProviderId
  isSaving: boolean
  model?: CustomModelConfig
  onClose: () => void
  onSave: (input: SaveCustomModelInput) => Promise<void>
  providers: readonly UserModelProviderOption[]
}

const REASONING_KIND_OPTIONS = [
  { label: 'No reasoning control', value: 'none' },
  { label: 'Enabled or disabled', value: 'toggle' },
  { label: 'Reasoning effort levels', value: 'effort' },
] as const

const EFFORT_LABELS: Record<ReasoningEffort, string> = {
  high: 'High',
  low: 'Low',
  max: 'Maximum',
  medium: 'Medium',
  minimal: 'Minimal',
  none: 'Disabled',
  xhigh: 'Extra high',
}

export function UserModelDialog({
  initialProviderId,
  isSaving,
  model,
  onClose,
  onSave,
  providers,
}: UserModelDialogProps) {
  const initialKind = getUserModelReasoningKind(model?.reasoningCapable ?? false, model?.reasoningEfforts)
  const [providerId, setProviderId] = useState<CustomModelProviderId>(model?.providerId ?? initialProviderId)
  const [apiModelId, setApiModelId] = useState(model?.apiModelId ?? '')
  const [label, setLabel] = useState(model?.label ?? '')
  const [extraBodyText, setExtraBodyText] = useState(formatModelExtraBody(model?.extraBody))
  const [reasoningKind, setReasoningKind] = useState<UserModelReasoningKind>(initialKind)
  const [effortChoices, setEffortChoices] = useState<ReasoningEffort[]>(
    initialKind === 'effort' && model?.reasoningEfforts?.length
      ? model.reasoningEfforts.filter((effort) => effort !== 'none')
      : ['low', 'medium', 'high'],
  )
  const [defaultEffort, setDefaultEffort] = useState<ReasoningEffort>(
    model?.defaultReasoningEffort ?? (initialKind === 'toggle' ? 'high' : 'medium'),
  )
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const firstInputRef = useRef<HTMLInputElement | null>(null)
  const availableEffortChoices = getSelectableUserModelEfforts(providerId)
  const selectedAvailableEfforts = effortChoices.filter((effort) => availableEffortChoices.includes(effort))
  const selectableDefaultEfforts: readonly ReasoningEffort[] = reasoningKind === 'toggle'
    ? ['none', 'high']
    : selectedAvailableEfforts
  const resolvedDefaultEffort = selectableDefaultEfforts.includes(defaultEffort)
    ? defaultEffort
    : selectableDefaultEfforts.includes('medium')
      ? 'medium'
      : selectableDefaultEfforts[0] ?? 'high'
  const defaultOptions = selectableDefaultEfforts.map((effort) => ({
    label: EFFORT_LABELS[effort],
    value: effort,
  }))

  useEffect(() => {
    firstInputRef.current?.focus()
  }, [])

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isSaving) onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isSaving, onClose])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErrorMessage(null)
    const normalizedModelId = apiModelId.trim()
    if (!normalizedModelId) {
      setErrorMessage('Model ID is required.')
      return
    }
    try {
      const extraBody = providerId.startsWith('custom:')
        ? parseModelExtraBodyText(extraBodyText)
        : {}
      const reasoning = buildUserModelReasoningProfile({
        defaultEffort: resolvedDefaultEffort,
        effortChoices: selectedAvailableEfforts,
        kind: reasoningKind,
        providerId,
      })
      await onSave({
        apiModelId: normalizedModelId,
        label: label.trim() || normalizedModelId,
        ...(Object.keys(extraBody).length > 0 ? { extraBody } : {}),
        ...(model ? { modelId: model.id } : {}),
        providerId,
        ...reasoning,
      })
      onClose()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to save this model.')
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 md:px-4 md:py-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSaving) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-model-dialog-title"
        className="flex h-full w-full flex-col overflow-hidden border-border bg-surface md:h-auto md:max-h-[calc(100dvh-3rem)] md:max-w-xl md:rounded-2xl md:border md:shadow-soft"
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-4 py-4 md:px-6">
          <div>
            <h2 id="user-model-dialog-title" className="text-lg font-semibold text-foreground">
              {model ? 'Edit model' : 'Add model'}
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Add a model ID and choose how its reasoning control should work.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close model dialog"
            onClick={onClose}
            disabled={isSaving}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-surface-muted hover:text-foreground disabled:opacity-50 md:h-9 md:w-9"
          >
            <X size={18} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-5 md:px-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium text-foreground">Provider</label>
                <DropdownField
                  ariaLabel="Model provider"
                  value={providerId}
                  onChange={(value) => {
                    const nextProviderId = value as CustomModelProviderId
                    const nextAvailableEfforts = getSelectableUserModelEfforts(nextProviderId)
                    setProviderId(nextProviderId)
                    setEffortChoices((current) => {
                      const retained = current.filter((effort) => nextAvailableEfforts.includes(effort))
                      return retained.length > 0 ? retained : [...nextAvailableEfforts]
                    })
                    if (nextProviderId === 'mistral' && reasoningKind === 'effort') {
                      setReasoningKind('toggle')
                    }
                  }}
                  options={providers}
                  disabled={isSaving}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="user-model-id" className="text-sm font-medium text-foreground">Model ID</label>
                <input
                  id="user-model-id"
                  ref={firstInputRef}
                  value={apiModelId}
                  onChange={(event) => setApiModelId(event.target.value)}
                  placeholder="model-name-or-id"
                  disabled={isSaving}
                  className="h-11 w-full rounded-xl border border-border bg-surface-muted px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="user-model-label" className="text-sm font-medium text-foreground">Display name</label>
                <input
                  id="user-model-label"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="Uses the model ID"
                  disabled={isSaving}
                  className="h-11 w-full rounded-xl border border-border bg-surface-muted px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
              </div>
            </div>

            {providerId.startsWith('custom:') ? (
              <LineNumberedTextarea
                id="user-model-extra-body"
                label="Extra settings (JSON)"
                description="Optional request settings sent only when this exact model is used."
                value={extraBodyText}
                onChange={setExtraBodyText}
                placeholder={'{\n  "chat_template_kwargs": {\n    "enable_thinking": true\n  }\n}'}
                rows={6}
                disabled={isSaving}
              />
            ) : null}

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Reasoning control</label>
              <DropdownField
                ariaLabel="Reasoning control type"
                value={reasoningKind}
                onChange={(value) => setReasoningKind(value as UserModelReasoningKind)}
                options={providerId === 'mistral'
                  ? REASONING_KIND_OPTIONS.filter((option) => option.value !== 'effort')
                  : REASONING_KIND_OPTIONS}
                disabled={isSaving}
              />
              <p className="text-xs leading-5 text-muted-foreground">
                This setting belongs only to this model and does not change other models from the provider.
              </p>
            </div>

            {reasoningKind === 'effort' ? (
              <div className="space-y-2">
                <span className="text-sm font-medium text-foreground">Available efforts</span>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {availableEffortChoices.map((effort) => {
                    const selected = effortChoices.includes(effort)
                    return (
                      <button
                        key={effort}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setEffortChoices((current) =>
                          selected ? current.filter((entry) => entry !== effort) : [...current, effort])}
                        disabled={isSaving}
                        className={[
                          'flex min-h-11 items-center justify-between rounded-xl border px-3 text-sm transition-colors',
                          selected
                            ? 'border-foreground bg-surface-muted text-foreground'
                            : 'border-border bg-surface text-muted-foreground hover:bg-surface-muted',
                        ].join(' ')}
                      >
                        {EFFORT_LABELS[effort]}
                        {selected ? <Check size={15} /> : null}
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}

            {reasoningKind !== 'none' && selectableDefaultEfforts.length > 0 ? (
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Default value</label>
                <DropdownField
                  ariaLabel="Default reasoning value"
                  value={resolvedDefaultEffort}
                  onChange={(value) => setDefaultEffort(value as ReasoningEffort)}
                  options={defaultOptions}
                  disabled={isSaving}
                />
              </div>
            ) : null}

            {providerId.startsWith('custom:') && reasoningKind !== 'none' ? (
              <p className="rounded-xl border border-border bg-surface-muted px-3 py-2 text-xs leading-5 text-muted-foreground">
                This custom provider will receive the selected value through the OpenAI-compatible reasoning effort field.
              </p>
            ) : null}

            {errorMessage ? (
              <p className="rounded-xl border border-danger-border bg-danger-surface px-3 py-2 text-sm text-danger-foreground">
                {errorMessage}
              </p>
            ) : null}
          </div>

          <footer className="flex flex-col-reverse gap-2 border-t border-border bg-surface px-4 py-4 sm:flex-row sm:justify-end md:px-6">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="h-11 rounded-xl border border-border bg-surface px-4 text-sm font-medium text-foreground hover:bg-surface-muted disabled:opacity-50"
            >
              Cancel
            </button>
            <button type="submit" disabled={isSaving} className={`${PRIMARY_ACTION_BUTTON_CLASS_NAME} h-11`}>
              {isSaving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {model ? 'Save changes' : 'Add model'}
            </button>
          </footer>
        </form>
      </div>
    </div>,
    document.body,
  )
}
