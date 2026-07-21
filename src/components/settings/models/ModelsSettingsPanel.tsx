import { Brain, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { PROVIDER_SECTIONS } from './modelCatalog'
import type { ModelToggleState } from './modelTypes'
import { buildModelProviderSections, isProviderConfigured } from './modelViewUtils'
import { readStoredModelToggleState, writeStoredModelToggleState } from './modelStorage'
import { useSettingsModelCatalog } from './settingsModelCatalogStore'
import { SETTINGS_SECTION_TITLE_CLASS_NAME } from '../shared/SettingsPanelPrimitives'
import { Switch } from '../../ui/Switch'
import type { ProvidersState } from '../../../types/chat'
import { resolveModelReasoningProfile } from '../../../lib/modelReasoningProfiles'

interface ModelsSettingsPanelProps {
  providersState: ProvidersState | null
}

function normalizeSearchValue(value: string): string {
  return value.trim().toLowerCase()
}

export function ModelsSettingsPanel({ providersState }: ModelsSettingsPanelProps) {
  const [searchValue, setSearchValue] = useState('')
  const [toggleState, setToggleState] = useState<ModelToggleState>(() => readStoredModelToggleState())
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
  const hasConfiguredProvider =
    PROVIDER_SECTIONS.some((provider) => isProviderConfigured(provider.id, providersState)) ||
    Boolean(providersState?.apiKeyProviders.some((provider) => provider.isCustom && provider.configured))
  const isAnyModelsLoading = customModelsLoading || providerModelsLoading

  useEffect(() => {
    writeStoredModelToggleState(toggleState)
  }, [toggleState])

  return (
    <div className="flex w-full max-w-[780px] flex-col gap-3">
      <header className="flex flex-col gap-1 px-1 pt-1">
        <h2 className={SETTINGS_SECTION_TITLE_CLASS_NAME}>Models</h2>
        <p className="text-sm leading-6 text-muted-foreground">
          Choose which connected models appear in your model picker.
        </p>
      </header>

      {customModelsErrorMessage ? (
        <div className="rounded-2xl border border-danger-border bg-danger-surface px-4 py-3 text-sm text-danger-foreground">
          {customModelsErrorMessage}
        </div>
      ) : null}

      {providerModelsErrorMessage ? (
        <div className="rounded-2xl border border-danger-border bg-danger-surface px-4 py-3 text-sm text-danger-foreground">
          {providerModelsErrorMessage}
        </div>
      ) : null}

      <section className="flex min-h-[420px] flex-none flex-col overflow-hidden rounded-2xl border border-border bg-surface md:max-h-[calc(100dvh-12rem)]">
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
            isAnyModelsLoading ? (
              <div className="px-4 py-6 text-sm text-muted-foreground md:px-5">Loading models...</div>
            ) : (
              <div className="px-4 py-6 text-sm text-muted-foreground md:px-5">
                No models are available until at least one provider is configured.
              </div>
            )
          ) : providerSections.length === 0 && !isAnyModelsLoading ? (
            <div className="px-4 py-6 text-sm text-muted-foreground md:px-5">No models found.</div>
          ) : providerSections.map((section, sectionIndex) => {
            return (
              <section key={section.provider.id} className={sectionIndex === 0 ? '' : 'border-t border-border'}>
                <header className="flex items-center justify-between gap-3 bg-surface-muted px-4 py-3 md:px-5">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{section.provider.label}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">{section.provider.description}</p>
                  </div>
                  <span className="rounded-lg bg-surface px-2.5 py-1 text-xs font-medium text-muted-foreground">
                    {section.models.length} {section.models.length === 1 ? 'model' : 'models'}
                  </span>
                </header>
                {section.models.map((model, modelIndex) => {
                  const isEnabled = Boolean(toggleState[model.id] ?? model.enabledByDefault)
                  const reasoningProfile = resolveModelReasoningProfile(model)

                  return (
                    <div
                      key={model.id}
                      className={`flex min-h-16 items-center justify-between gap-3 px-4 py-3 md:px-5 ${modelIndex === 0 ? '' : 'border-t border-border'}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{model.label}</p>
                        {reasoningProfile ? (
                          <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-surface-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
                            <Brain size={12} /> Reasoning
                          </span>
                        ) : null}
                      </div>
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
                  )
                })}
              </section>
            )
          })}
        </div>
      </section>
    </div>
  )
}
