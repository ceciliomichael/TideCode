import { Plus } from 'lucide-react'
import { useState } from 'react'
import type {
  ApiKeyProviderId,
  ApiKeyProviderStatus,
  BuiltInApiKeyProviderId,
  ProvidersState,
  SaveApiKeyProviderInput,
} from '../../../types/chat'
import { SettingsPanelLayout, SETTINGS_SECTION_TITLE_CLASS_NAME } from '../shared/SettingsPanelPrimitives'
import { CodexProviderDialog } from './CodexProviderDialog'
import { ProviderCard } from './ProviderCard'
import { ProviderConfigDialog } from './ProviderConfigDialog'
import { API_KEY_PROVIDER_SCHEMAS, type ApiKeyProviderSchema } from './providerSchemas'

const ADD_PROVIDER_BUTTON_CLASS_NAME =
  'provider-primary-action-button inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl px-3.5 text-sm font-medium transition-transform active:scale-[0.99] disabled:opacity-50 md:h-10 md:w-auto'

interface ProvidersSettingsPanelProps {
  activeOperation: string | null
  errorMessage: string | null
  isLoading: boolean
  onAddCodexAccountWithOAuth: () => Promise<boolean>
  onConnectCodexWithOAuth: () => Promise<boolean>
  onDisconnectCodex: () => Promise<boolean>
  onRemoveCodexAccount: (accountKey: string) => Promise<boolean>
  onRemoveApiKeyProvider: (providerId: ApiKeyProviderId) => Promise<boolean>
  onSaveApiKeyProvider: (input: SaveApiKeyProviderInput) => Promise<boolean>
  onSwitchCodexAccount: (accountKey: string) => Promise<boolean>
  providersState: ProvidersState | null
}

type ProviderDialogState =
  | { kind: 'codex' }
  | { kind: 'built-in'; schema: ApiKeyProviderSchema; status?: ApiKeyProviderStatus }
  | { kind: 'custom'; status?: ApiKeyProviderStatus }

const CUSTOM_PROVIDER_SCHEMA = {
  apiKeyOptional: true,
  baseUrlRequired: true,
  defaultBaseUrl: 'http://localhost:1234/v1',
  description: 'Connect another model service and give it a name you will recognize.',
  extraBodyExample: '{\n  "chat_template_kwargs": {\n    "enable_thinking": true\n  }\n}',
  extraBodyHelp: 'Add optional settings for this provider.',
  id: 'custom' as any,
  label: 'Custom provider',
  showBaseUrl: true,
} as ApiKeyProviderSchema

export function ProvidersSettingsPanel(props: ProvidersSettingsPanelProps) {
  const [dialog, setDialog] = useState<ProviderDialogState | null>(null)
  const statuses = props.providersState?.apiKeyProviders ?? []
  const customStatuses = statuses.filter((status) => status.isCustom)
  const isApiKeyOperation = props.activeOperation?.startsWith('apikey:') ?? false

  function findStatus(providerId: BuiltInApiKeyProviderId) {
    return statuses.find((status) => status.id === providerId)
  }

  async function saveProvider(input: SaveApiKeyProviderInput) {
    return props.onSaveApiKeyProvider(input)
  }

  async function removeProvider(providerId: ApiKeyProviderId) {
    return props.onRemoveApiKeyProvider(providerId)
  }

  return (
    <SettingsPanelLayout>
      <div className="flex flex-col gap-4">
        <header className="flex flex-col gap-1 px-1 pt-1">
          <h2 className={SETTINGS_SECTION_TITLE_CLASS_NAME}>Providers</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Choose a provider to configure it. API keys and request settings are saved locally for all workspaces.
          </p>
        </header>

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <p className="text-sm text-muted-foreground">Connect as many other model services as you need.</p>
          <button type="button" onClick={() => setDialog({ kind: 'custom' })} className={ADD_PROVIDER_BUTTON_CLASS_NAME}>
            <Plus size={15} /> Add custom provider
          </button>
        </div>

        {props.errorMessage ? (
          <div className="rounded-2xl border border-danger-border bg-danger-surface px-4 py-3 text-sm text-danger-foreground">{props.errorMessage}</div>
        ) : null}

        <div className="flex flex-col gap-2.5">
          <ProviderCard
            isCodex
            label="Codex"
            description="Connect your ChatGPT account to use Codex models."
            isConfigured={Boolean(props.providersState?.codex.isAuthenticated)}
            onClick={() => setDialog({ kind: 'codex' })}
          />
          {API_KEY_PROVIDER_SCHEMAS.map((schema) => {
            const status = findStatus(schema.id)
            return (
              <ProviderCard
                key={schema.id}
                label={schema.label}
                description={schema.description}
                status={status}
                onClick={() => setDialog({ kind: 'built-in', schema, status })}
              />
            )
          })}
          {customStatuses.map((status) => (
            <ProviderCard
              key={status.id}
              label={status.label}
              description="Your connected model service."
              status={status}
              onClick={() => setDialog({ kind: 'custom', status })}
            />
          ))}
        </div>
      </div>

      {dialog?.kind === 'codex' ? (
        <CodexProviderDialog
          activeOperation={props.activeOperation}
          onAddAccount={props.onAddCodexAccountWithOAuth}
          onClose={() => setDialog(null)}
          onConnect={props.onConnectCodexWithOAuth}
          onDisconnect={props.onDisconnectCodex}
          onRemoveAccount={props.onRemoveCodexAccount}
          onSwitchAccount={props.onSwitchCodexAccount}
          status={props.providersState?.codex}
        />
      ) : null}

      {dialog?.kind === 'built-in' ? (
        <ProviderConfigDialog
          isCustom={false}
          isSubmitting={props.isLoading || isApiKeyOperation}
          onClose={() => setDialog(null)}
          onRemove={dialog.status?.configured ? () => removeProvider(dialog.schema.id) : undefined}
          onSubmit={saveProvider}
          schema={dialog.schema}
          status={dialog.status}
        />
      ) : null}

      {dialog?.kind === 'custom' ? (
        <ProviderConfigDialog
          isCustom
          isSubmitting={props.isLoading || isApiKeyOperation}
          onClose={() => setDialog(null)}
          onRemove={dialog.status ? () => removeProvider(dialog.status!.id) : undefined}
          onSubmit={(input) =>
            saveProvider({
              ...input,
              providerId: dialog.status?.id ?? `custom:${crypto.randomUUID()}`,
            })
          }
          schema={CUSTOM_PROVIDER_SCHEMA}
          status={dialog.status}
        />
      ) : null}
    </SettingsPanelLayout>
  )
}
