import { ChevronDown, ChevronUp, Loader2, Save, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  getDefaultCustomModelMaxOutputTokens,
  isValidMaxOutputTokens,
} from '../../../lib/modelOutputTokens'
import { toUserFacingErrorMessage } from '../../../lib/userFacingError'
import { DropdownField } from '../../ui/DropdownField'
import { PRIMARY_ACTION_BUTTON_CLASS_NAME } from '../shared/actionButtonStyles'
import {
  buildUserModelReasoningProfile,
  getUserModelReasoningKind,
  type UserModelReasoningKind,
} from '../../../lib/userModelReasoning'
import type {
  CustomModelConfig,
  CustomModelProviderId,
  ReasoningEffort,
  ReasoningRequestBodies,
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
  { label: 'No reasoning support', value: 'none' },
  { label: 'Reasoning on or off', value: 'toggle' },
  { label: 'Custom reasoning control', value: 'effort' },
] as const

const REASONING_KIND_OPTIONS_BUILTIN = [
  { label: 'No reasoning support', value: 'none' },
  { label: 'Uses provider standard reasoning', value: 'provider_default' },
] as const

export function UserModelDialog({
  initialProviderId,
  isSaving,
  model,
  onClose,
  onSave,
  providers,
}: UserModelDialogProps) {
  const initialProvider = model?.providerId ?? initialProviderId
  const initialKind = getUserModelReasoningKind(
    model?.reasoningCapable ?? false,
    model?.reasoningEfforts,
    initialProvider
  )
  const [providerId, setProviderId] = useState<CustomModelProviderId>(initialProvider)
  const [apiModelId, setApiModelId] = useState(model?.apiModelId ?? '')
  const [label, setLabel] = useState(model?.label ?? '')
  const [maxTokens, setMaxTokens] = useState<string>(
    model?.providerId === 'mistral' ? '' : model?.maxTokens?.toString() ?? '',
  )
  
  const [kvSettings, setKvSettings] = useState<{ id: number; key: string; value: string }[]>(() => {
    if (!model?.extraBody || Object.keys(model.extraBody).length === 0) {
      return [{ id: Date.now(), key: '', value: '' }]
    }
    return Object.entries(model.extraBody).map(([k, v], index) => ({
      id: Date.now() + index,
      key: k,
      value: typeof v === 'string' ? v : JSON.stringify(v),
    }))
  })

  const [customReasoningLevels, setCustomReasoningLevels] = useState<{
    id: number
    name: string
    settings: { id: number; key: string; value: string }[]
  }[]>(() => {
    if (!providerId.startsWith('custom:')) return []
    const bodies = model?.reasoningBodies ?? {}
    const efforts = model?.reasoningEfforts?.filter((e) => e !== 'none') ?? []
    if (efforts.length === 0) return [{ id: Date.now(), name: '', settings: [{ id: Date.now() + 1, key: '', value: '' }] }]
    return efforts.map((effort, i) => {
      const body = bodies[effort]
      const settings = body && Object.keys(body).length > 0
        ? Object.entries(body).map(([k, v], index) => ({
            id: Date.now() + index + Math.random(),
            key: k,
            value: typeof v === 'string' ? v : JSON.stringify(v),
          }))
        : [{ id: Date.now() + Math.random(), key: '', value: '' }]
      return {
        id: Date.now() + i + Math.random(),
        name: effort,
        settings,
      }
    })
  })

  const [reasoningKind, setReasoningKind] = useState<UserModelReasoningKind>(initialKind)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const firstInputRef = useRef<HTMLInputElement | null>(null)
  const previousProviderIdRef = useRef<CustomModelProviderId>(initialProvider)
  const defaultMaxOutputTokens = getDefaultCustomModelMaxOutputTokens(providerId)
  const maxTokensPlaceholder = defaultMaxOutputTokens === undefined
    ? 'Provider default'
    : `Default: ${defaultMaxOutputTokens.toLocaleString()}`

  useEffect(() => {
    const previousProviderId = previousProviderIdRef.current
    if (previousProviderId === providerId) return

    if (providerId === 'mistral') {
      setMaxTokens('')
    } else {
      const previousDefault = getDefaultCustomModelMaxOutputTokens(previousProviderId)?.toString() ?? ''
      setMaxTokens((currentValue) => currentValue.trim() === previousDefault ? '' : currentValue)
    }
    previousProviderIdRef.current = providerId
  }, [providerId])

  // Ensure reasoningKind is valid when provider switches
  useEffect(() => {
    if (providerId.startsWith('custom:')) {
      if (reasoningKind === 'provider_default') setReasoningKind('none')
    } else {
      if (reasoningKind === 'effort' || reasoningKind === 'toggle') {
        setReasoningKind('provider_default')
      }
    }
  }, [providerId, reasoningKind])

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
    const normalizedMaxTokens = maxTokens.trim()
    const parsedMaxTokens = providerId === 'mistral'
      ? undefined
      : normalizedMaxTokens.length > 0
        ? Number(normalizedMaxTokens)
        : getDefaultCustomModelMaxOutputTokens(providerId)
    if (parsedMaxTokens !== undefined && !isValidMaxOutputTokens(parsedMaxTokens)) {
      setErrorMessage('Max output tokens must be a positive whole number.')
      return
    }
    try {
      const extraBody: Record<string, unknown> = {}
      if (providerId.startsWith('custom:')) {
        for (const kv of kvSettings) {
          const k = kv.key.trim()
          if (k) {
            const v = kv.value.trim()
            try {
              extraBody[k] = JSON.parse(v)
            } catch {
              extraBody[k] = v
            }
          }
        }
      }
      const customReasoningBodies: ReasoningRequestBodies = {}
      let finalEffortChoices: ReasoningEffort[] = []

      if (providerId.startsWith('custom:')) {
        if (reasoningKind === 'effort') {
          for (const level of customReasoningLevels) {
            const effortName = level.name.trim() as ReasoningEffort
            if (!effortName || effortName === 'none') continue
            finalEffortChoices.push(effortName)

            if (level.settings.some(kv => kv.key.trim() !== '')) {
              const body = level.settings.reduce<Record<string, unknown>>((acc, kv) => {
                const k = kv.key.trim()
                if (k) {
                  try {
                    acc[k] = JSON.parse(kv.value.trim())
                  } catch {
                    acc[k] = kv.value.trim()
                  }
                }
                return acc
              }, {})
              if (Object.keys(body).length > 0) {
                customReasoningBodies[effortName] = body
              }
            }
          }
        }
      } else {
        // Built-in providers don't use this modal for configuring efforts
        finalEffortChoices = []
      }

      const reasoning = buildUserModelReasoningProfile({
        effortChoices: finalEffortChoices.length > 0 ? ['none', ...finalEffortChoices] : undefined,
        kind: reasoningKind,
        providerId,
        customReasoningBodies: Object.keys(customReasoningBodies).length > 0 ? customReasoningBodies : undefined,
      })
      await onSave({
        apiModelId: normalizedModelId,
        label: label.trim() || normalizedModelId,
        ...(Object.keys(extraBody).length > 0 ? { extraBody } : {}),
        ...(model ? { modelId: model.id } : {}),
        ...(parsedMaxTokens !== undefined ? { maxTokens: parsedMaxTokens } : {}),
        providerId,
        ...reasoning,
      })
      onClose()
    } catch (error) {
      setErrorMessage(toUserFacingErrorMessage(error, 'Unable to save this model.'))
    }
  }

  return createPortal(
    <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-3 sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSaving) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-model-dialog-title"
                className="flex h-[min(650px,calc(100dvh-1.5rem))] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-soft sm:h-[min(650px,calc(100dvh-2rem))]"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-4 py-4 md:px-6">
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
                    setProviderId(nextProviderId)
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
              {providerId !== 'mistral' ? (
                <div className="space-y-2">
                  <label htmlFor="user-model-maxtokens" className="text-sm font-medium text-foreground">Max Output Tokens</label>
                  <input
                    id="user-model-maxtokens"
                    type="number"
                    min="1"
                    step="1"
                    value={maxTokens}
                    onChange={(event) => setMaxTokens(event.target.value)}
                    placeholder={maxTokensPlaceholder}
                    disabled={isSaving}
                    className="h-11 w-full rounded-xl border border-border bg-surface-muted px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
              ) : null}
            </div>

            {providerId.startsWith('custom:') ? (
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium text-foreground">Extra settings</label>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Optional request settings sent only when this exact model is used.
                  </p>
                </div>
                <div className="space-y-2">
                  {kvSettings.map((kv, index) => (
                    <div key={kv.id} className="flex gap-2">
                      <input
                        value={kv.key}
                        onChange={(e) => {
                          const newKv = [...kvSettings]
                          newKv[index].key = e.target.value
                          setKvSettings(newKv)
                        }}
                        placeholder="Key (e.g. enable_thinking)"
                        disabled={isSaving}
                        className="h-10 w-1/2 rounded-xl border border-border bg-surface-muted px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                      />
                      <input
                        value={kv.value}
                        onChange={(e) => {
                          const newKv = [...kvSettings]
                          newKv[index].value = e.target.value
                          setKvSettings(newKv)
                        }}
                        placeholder="Value (e.g. true)"
                        disabled={isSaving}
                        className="h-10 w-1/2 rounded-xl border border-border bg-surface-muted px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (kvSettings.length > 1) {
                            setKvSettings(kvSettings.filter((_, i) => i !== index))
                          } else {
                            setKvSettings([{ id: Date.now(), key: '', value: '' }])
                          }
                        }}
                        disabled={isSaving}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setKvSettings([...kvSettings, { id: Date.now(), key: '', value: '' }])}
                    disabled={isSaving}
                    className="inline-flex h-9 items-center justify-center rounded-xl bg-surface-muted px-4 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted/80"
                  >
                    + Add setting
                  </button>
                </div>
              </div>
            ) : null}

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Reasoning control</label>
              <DropdownField
                ariaLabel="Reasoning control type"
                value={reasoningKind}
                onChange={(value) => setReasoningKind(value as UserModelReasoningKind)}
                options={providerId.startsWith('custom:')
                  ? REASONING_KIND_OPTIONS
                  : REASONING_KIND_OPTIONS_BUILTIN}
                disabled={isSaving}
              />
              <p className="text-xs leading-5 text-muted-foreground">
                This setting belongs only to this model and does not change other models from the provider.
              </p>
            </div>

            {providerId.startsWith('custom:') && reasoningKind === 'effort' ? (
              <div className="space-y-4 pt-2">
                {customReasoningLevels.map((level, levelIndex) => {
                  return (
                    <div key={level.id} className="space-y-3 rounded-xl border border-border p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 flex flex-col gap-2">
                          <label className="text-sm font-medium text-foreground">Custom Reasoning Level</label>
                          <input
                            value={level.name}
                            onChange={(e) => {
                              const newLevels = [...customReasoningLevels]
                              newLevels[levelIndex].name = e.target.value
                              setCustomReasoningLevels(newLevels)
                            }}
                            placeholder="Name (e.g. Smart Mode)"
                            disabled={isSaving}
                            className="h-10 w-full max-w-sm rounded-xl border border-border bg-surface-muted px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            aria-label="Move level up"
                            onClick={() => {
                              if (levelIndex > 0) {
                                const newLevels = [...customReasoningLevels]
                                const temp = newLevels[levelIndex]
                                newLevels[levelIndex] = newLevels[levelIndex - 1]
                                newLevels[levelIndex - 1] = temp
                                setCustomReasoningLevels(newLevels)
                              }
                            }}
                            disabled={isSaving || levelIndex === 0}
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-surface-muted hover:text-foreground disabled:opacity-30"
                          >
                            <ChevronUp className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            aria-label="Move level down"
                            onClick={() => {
                              if (levelIndex < customReasoningLevels.length - 1) {
                                const newLevels = [...customReasoningLevels]
                                const temp = newLevels[levelIndex]
                                newLevels[levelIndex] = newLevels[levelIndex + 1]
                                newLevels[levelIndex + 1] = temp
                                setCustomReasoningLevels(newLevels)
                              }
                            }}
                            disabled={isSaving || levelIndex === customReasoningLevels.length - 1}
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-surface-muted hover:text-foreground disabled:opacity-30"
                          >
                            <ChevronDown className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (customReasoningLevels.length > 1) {
                                setCustomReasoningLevels(customReasoningLevels.filter((_, i) => i !== levelIndex))
                              }
                            }}
                            disabled={isSaving || customReasoningLevels.length <= 1}
                            className="ml-2 text-sm font-medium text-danger-foreground disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                      
                      <div className="space-y-2 pt-2">
                        <label className="text-sm font-medium text-foreground">Payload</label>
                        {level.settings.map((kv, kvIndex) => (
                          <div key={kv.id} className="flex gap-2">
                            <input
                              value={kv.key}
                              onChange={(e) => {
                                const newLevels = [...customReasoningLevels]
                                newLevels[levelIndex].settings[kvIndex].key = e.target.value
                                setCustomReasoningLevels(newLevels)
                              }}
                              placeholder="Key (e.g. chat_template_kwargs)"
                              disabled={isSaving}
                              className="h-10 w-1/2 rounded-xl border border-border bg-surface-muted px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                            />
                            <input
                              value={kv.value}
                              onChange={(e) => {
                                const newLevels = [...customReasoningLevels]
                                newLevels[levelIndex].settings[kvIndex].value = e.target.value
                                setCustomReasoningLevels(newLevels)
                              }}
                              placeholder='Value (e.g. {"thinking":true})'
                              disabled={isSaving}
                              className="h-10 w-1/2 rounded-xl border border-border bg-surface-muted px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const newLevels = [...customReasoningLevels]
                                if (level.settings.length > 1) {
                                  newLevels[levelIndex].settings = level.settings.filter((_, i) => i !== kvIndex)
                                } else {
                                  newLevels[levelIndex].settings = [{ id: Date.now(), key: '', value: '' }]
                                }
                                setCustomReasoningLevels(newLevels)
                              }}
                              disabled={isSaving}
                              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => {
                            const newLevels = [...customReasoningLevels]
                            newLevels[levelIndex].settings.push({ id: Date.now(), key: '', value: '' })
                            setCustomReasoningLevels(newLevels)
                          }}
                          disabled={isSaving}
                          className="inline-flex h-9 items-center justify-center rounded-xl bg-surface-muted px-4 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted/80"
                        >
                          + Add payload field
                        </button>
                      </div>
                    </div>
                  )
                })}
                <button
                  type="button"
                  onClick={() => setCustomReasoningLevels([...customReasoningLevels, { id: Date.now(), name: '', settings: [{ id: Date.now() + 1, key: '', value: '' }] }])}
                  disabled={isSaving}
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-border bg-surface px-4 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted"
                >
                  + Add reasoning level
                </button>
              </div>
            ) : null}

            {errorMessage ? (
              <p className="rounded-xl border border-danger-border bg-danger-surface px-3 py-2 text-sm text-danger-foreground">
                {errorMessage}
              </p>
            ) : null}
          </div>

          <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-border bg-surface px-4 py-4 sm:flex-row sm:justify-end md:px-6">
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
