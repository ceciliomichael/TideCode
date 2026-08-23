import { Brain, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toUserFacingErrorMessage } from '../../../lib/userFacingError'
import { resolveModelReasoningProfile } from '../../../lib/modelReasoningProfiles'
import type {
  CustomModelConfig,
  ProvidersState,
  SaveCustomModelInput,
} from '../../../types/chat'
import type { TideCodeSettingsLaunchRequest } from '../../../lib/appLaunchRequest'
import { Switch } from '../../ui/Switch'
import { SETTINGS_SECTION_TITLE_CLASS_NAME } from '../shared/SettingsPanelPrimitives'
import { buildModelProviderSections, listConfiguredModelProviders } from './modelViewUtils'
import { readStoredModelToggleState, writeStoredModelToggleState } from './modelStorage'
import type { ModelToggleState } from './modelTypes'
import { RemoveUserModelDialog } from './RemoveUserModelDialog'
import {
  replaceCustomModels,
  useSettingsModelCatalog,
} from './settingsModelCatalogStore'
import { UserModelDialog } from './UserModelDialog'
import { ModelsSettingsSkeleton } from './ModelsSettingsSkeleton'

const ADD_MODEL_BUTTON_CLASS_NAME =
  'provider-primary-action-button inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl px-3.5 text-sm font-medium transition-transform active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 md:h-10 md:w-auto'

interface ModelsSettingsPanelProps {
  launchRequest: TideCodeSettingsLaunchRequest | null
  onLaunchRequestHandled: (request: TideCodeSettingsLaunchRequest) => void
  providersState: ProvidersState | null
}

function normalizeSearchValue(value: string): string {
  return value.trim().toLowerCase()
}

function getErrorMessage(error: unknown, fallback: string) {
  return toUserFacingErrorMessage(error, fallback)
}

export function ModelsSettingsPanel({ launchRequest, onLaunchRequestHandled, providersState }: ModelsSettingsPanelProps) {
  const [searchValue, setSearchValue] = useState('')
  const [toggleState, setToggleState] = useState<ModelToggleState>(() => readStoredModelToggleState())
  const [dialogState, setDialogState] = useState<{
    instanceKey?: number
    model?: CustomModelConfig
    providerId: CustomModelConfig['providerId']
  } | null>(null)
  const [modelPendingRemoval, setModelPendingRemoval] = useState<CustomModelConfig | null>(null)
  const [isSavingModel, setIsSavingModel] = useState(false)
  const [isRemovingModel, setIsRemovingModel] = useState(false)
  const [operationError, setOperationError] = useState<string | null>(null)
  const handledLaunchRequest = useRef<TideCodeSettingsLaunchRequest | null>(null)
  const nextExternalDialogKey = useRef(0)
  const {
    customModels,
    customModelsErrorMessage,
    customModelsLoading,
    providerModels,
    providerModelsErrorMessage,
    providerModelsLoading,
  } = useSettingsModelCatalog(providersState)

  const normalizedSearchValue = normalizeSearchValue(searchValue)
  const providerSections = useMemo(
    () => buildModelProviderSections(normalizedSearchValue, providersState, customModels, providerModels),
    [customModels, normalizedSearchValue, providerModels, providersState],
  )
  const configuredProviders = useMemo(
    () => listConfiguredModelProviders(providersState),
    [providersState],
  )
  const providerOptions = useMemo(
    () => configuredProviders.map((provider) => ({ label: provider.label, value: provider.id })),
    [configuredProviders],
  )
  const customModelsById = useMemo(
    () => new Map(customModels.map((model) => [model.id, model] as const)),
    [customModels],
  )
  const hasConfiguredProvider = configuredProviders.length > 0
  const isAnyModelsLoading = customModelsLoading || providerModelsLoading

  useEffect(() => {
    writeStoredModelToggleState(toggleState)
  }, [toggleState])

  useEffect(() => {
    if (!launchRequest || launchRequest.section !== 'models' || launchRequest.action !== 'add-model') {
      handledLaunchRequest.current = null
      return
    }
    if (handledLaunchRequest.current === launchRequest || providersState === null) {
      return
    }

    handledLaunchRequest.current = launchRequest
    const requestedProvider = launchRequest.providerId
      ? configuredProviders.find((provider) => provider.id === launchRequest.providerId)
      : undefined
    if (launchRequest.providerId && !requestedProvider) {
      setOperationError(`Provider "${launchRequest.providerId}" is not configured in desktop Settings → Providers. Configure it there first, then retry adding the model.`)
      onLaunchRequestHandled(launchRequest)
      return
    }

    const firstProvider = requestedProvider ?? configuredProviders[0]
    if (!firstProvider) {
      onLaunchRequestHandled(launchRequest)
      return
    }

    nextExternalDialogKey.current += 1
    setDialogState({ instanceKey: nextExternalDialogKey.current, providerId: firstProvider.id })
    onLaunchRequestHandled(launchRequest)
  }, [configuredProviders, launchRequest, onLaunchRequestHandled, providersState])

  async function saveUserModel(input: SaveCustomModelInput) {
    setIsSavingModel(true)
    setOperationError(null)
    try {
      replaceCustomModels(await window.tidecodeModels.saveCustomModel(input))
    } finally {
      setIsSavingModel(false)
    }
  }

  async function removeUserModel() {
    if (!modelPendingRemoval) return
    setIsRemovingModel(true)
    setOperationError(null)
    try {
      replaceCustomModels(await window.tidecodeModels.removeCustomModel(modelPendingRemoval.id))
      setToggleState((currentValue) => {
        const nextValue = { ...currentValue }
        delete nextValue[modelPendingRemoval.id]
        return nextValue
      })
      setModelPendingRemoval(null)
    } catch (error) {
      setOperationError(getErrorMessage(error, 'Unable to remove this model.'))
    } finally {
      setIsRemovingModel(false)
    }
  }

  if (providersState === null || isAnyModelsLoading) {
    return <ModelsSettingsSkeleton />
  }

  return (
    <div className="flex w-full max-w-[780px] flex-col gap-3">
      <header className="flex flex-col gap-1 px-1 pt-1">
        <h2 className={SETTINGS_SECTION_TITLE_CLASS_NAME}>Models</h2>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <p className="min-w-0 flex-1 text-sm leading-6 text-muted-foreground">
            Choose which connected models appear, or add a model ID from any built-in or custom provider.
          </p>
          <button
            type="button"
            disabled={!hasConfiguredProvider}
            onClick={() => {
              const firstProvider = configuredProviders[0]
              if (firstProvider) setDialogState({ providerId: firstProvider.id })
            }}
            className={`${ADD_MODEL_BUTTON_CLASS_NAME} md:shrink-0`}
          >
            <Plus size={15} /> Add model
          </button>
        </div>
      </header>

      {[customModelsErrorMessage, providerModelsErrorMessage, operationError]
        .filter((message): message is string => Boolean(message))
        .map((message) => (
          <div
            key={message}
            className="rounded-xl border border-danger-border bg-danger-surface px-4 py-3 text-sm text-danger-foreground"
          >
            {message}
          </div>
        ))}

      <section className="flex min-h-[280px] max-h-[calc(100dvh-14rem)] flex-none flex-col overflow-hidden rounded-xl border border-border bg-surface md:min-h-[360px] md:max-h-[calc(100dvh-16.5rem)]">
        <div className="border-b border-border px-4 py-3 md:px-5">
          <div className="relative">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="text"
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder="Search models..."
              disabled={!hasConfiguredProvider}
              className="h-11 w-full rounded-xl border border-border bg-surface-muted pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-subtle-foreground disabled:cursor-not-allowed disabled:opacity-60 md:h-10"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!hasConfiguredProvider ? (
            <div className="px-4 py-6 text-sm text-muted-foreground md:px-5">
              {isAnyModelsLoading
                ? 'Loading models...'
                : 'No models are available until at least one provider is configured.'}
            </div>
          ) : providerSections.length === 0 && !isAnyModelsLoading ? (
            <div className="px-4 py-6 text-sm text-muted-foreground md:px-5">No models found.</div>
          ) : providerSections.map((section, sectionIndex) => (
            <section key={section.provider.id} className={sectionIndex === 0 ? '' : 'border-t border-border'}>
              <header className="flex items-center justify-between gap-3 bg-surface-muted px-4 py-3 md:px-5">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-foreground">{section.provider.label}</h3>
                  <p className="mt-0.5 hidden text-xs text-muted-foreground sm:block">{section.provider.description}</p>
                </div>
                <span className="shrink-0 rounded-lg bg-surface px-2.5 py-1 text-xs font-medium text-muted-foreground">
                  {section.models.length} {section.models.length === 1 ? 'model' : 'models'}
                </span>
              </header>

              {section.models.length === 0 ? (
                <div className="px-4 py-5 text-sm text-muted-foreground md:px-5">
                  No models added yet. Use Add model above to add one to this provider.
                </div>
              ) : null}

              {section.models.map((model, modelIndex) => {
                const isEnabled = Boolean(toggleState[model.id] ?? model.enabledByDefault)
                const reasoningProfile = resolveModelReasoningProfile(model)
                const customModel = customModelsById.get(model.id)
                return (
                  <div
                    key={model.id}
                    className={`flex min-h-16 items-center justify-between gap-3 px-4 py-3 md:px-5 ${modelIndex === 0 ? '' : 'border-t border-border'}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="truncate text-sm font-medium text-foreground">{model.label}</p>
                        {customModel ? (
                          <span className="rounded-lg bg-surface-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            Custom
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{model.apiModelId ?? model.id}</p>
                      {reasoningProfile ? (
                        <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-surface-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
                          <Brain size={12} /> Reasoning
                        </span>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {customModel ? (
                        <>
                          <button
                            type="button"
                            aria-label={`Edit ${model.label}`}
                            onClick={() => setDialogState({ model: customModel, providerId: customModel.providerId })}
                            className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-surface text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground md:h-9 md:w-9"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove ${model.label}`}
                            onClick={() => setModelPendingRemoval(customModel)}
                            className="flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-surface text-muted-foreground transition-colors hover:border-danger-border hover:bg-danger-surface hover:text-danger-foreground md:h-9 md:w-9"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      ) : null}
                      <Switch
                        checked={isEnabled}
                        label={`Enable ${model.label}`}
                        onChange={() => {
                          setToggleState((currentValue) => ({
                            ...currentValue,
                            [model.id]: !(currentValue[model.id] ?? model.enabledByDefault ?? true),
                          }))
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </section>
          ))}
        </div>
      </section>

      {dialogState ? (
        <UserModelDialog
          key={dialogState.instanceKey ?? 'model-dialog'}
          initialProviderId={dialogState.providerId}
          isSaving={isSavingModel}
          model={dialogState.model}
          onClose={() => {
            if (!isSavingModel) setDialogState(null)
          }}
          onSave={saveUserModel}
          providers={providerOptions}
        />
      ) : null}

      {modelPendingRemoval ? (
        <RemoveUserModelDialog
          isRemoving={isRemovingModel}
          model={modelPendingRemoval}
          onCancel={() => {
            if (!isRemovingModel) setModelPendingRemoval(null)
          }}
          onConfirm={removeUserModel}
        />
      ) : null}
    </div>
  )
}
