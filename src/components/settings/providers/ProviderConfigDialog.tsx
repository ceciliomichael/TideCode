import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Eraser, Eye, EyeOff, Loader2, Save, Trash2, X } from 'lucide-react'
import type {
  ApiKeyProviderStatus,
  SaveApiKeyProviderInput,
} from '../../../types/chat'
import { PRIMARY_ACTION_BUTTON_CLASS_NAME } from '../shared/actionButtonStyles'
import type { ApiKeyProviderSchema } from './providerSchemas'

interface ProviderConfigDialogProps {
  initialWarning?: string
  isCustom: boolean
  isSubmitting: boolean
  onClose: () => void
  onRemove?: () => Promise<boolean>
  onSubmit: (input: SaveApiKeyProviderInput) => Promise<boolean>
  initialValues?: ProviderConfigInitialValues
  schema: ApiKeyProviderSchema<ApiKeyProviderStatus['id']>
  status?: ApiKeyProviderStatus
}

export interface ProviderConfigInitialValues {
  apiKey?: string
  baseUrl?: string
  label?: string
}

export function ProviderConfigDialog({
  initialWarning,
  isCustom,
  isSubmitting,
  initialValues,
  onClose,
  onRemove,
  onSubmit,
  schema,
  status,
}: ProviderConfigDialogProps) {
  const [apiKey, setApiKey] = useState(initialValues?.apiKey ?? status?.apiKey ?? '')
  const [baseUrl, setBaseUrl] = useState(initialValues?.baseUrl ?? status?.baseUrl ?? '')
  const [label, setLabel] = useState(initialValues?.label ?? status?.label ?? (isCustom ? '' : schema.label))
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false)
  const [warning, setWarning] = useState<string | null>(initialWarning ?? null)
  const [localError, setLocalError] = useState<string | null>(null)
  const firstInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    firstInputRef.current?.focus()
  }, [])

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isSubmitting) {
        onClose()
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isSubmitting, onClose])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLocalError(null)
    const normalizedLabel = label.trim()
    const normalizedBaseUrl = schema.showBaseUrl
      ? baseUrl.trim() || status?.baseUrl?.trim() || ''
      : ''

    if (isCustom && !normalizedLabel) {
      setLocalError('Provider name is required.')
      return
    }
    if (!schema.apiKeyOptional && !apiKey.trim() && !status?.hasApiKey) {
      setLocalError('API key is required for this provider.')
      return
    }
    if (schema.baseUrlRequired && !normalizedBaseUrl) {
      setLocalError('Base URL is required for this provider.')
      return
    }
    const input: SaveApiKeyProviderInput = {
      apiKey: apiKey.trim(),
      baseUrl: normalizedBaseUrl,
      ...(isCustom ? { label: normalizedLabel } : {}),
      providerId: status?.id ?? schema.id,
    }
    onClose()
    void onSubmit(input).catch(() => undefined)
  }

  const title = status?.configured ? `Edit ${status.label}` : isCustom ? 'Add custom provider' : `Set up ${schema.label}`

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 md:px-4 md:py-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) {
          onClose()
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-dialog-title"
        className="flex h-full w-full flex-col overflow-hidden border-border bg-surface md:h-auto md:max-h-[calc(100dvh-3rem)] md:max-w-2xl md:rounded-xl md:border md:shadow-soft"
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-4 py-4 md:px-6">
          <div className="min-w-0">
            <h2 id="provider-dialog-title" className="text-lg font-semibold text-foreground">{title}</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{schema.description}</p>
          </div>
          <button
            type="button"
            aria-label="Close provider dialog"
            onClick={onClose}
            disabled={isSubmitting}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-surface-muted hover:text-foreground disabled:opacity-50 md:h-9 md:w-9"
          >
            <X size={18} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
            <div className="grid gap-4 md:grid-cols-2 md:gap-x-5">
              {isCustom ? (
                <div className="space-y-2 md:col-span-2">
                  <label htmlFor="provider-name" className="text-sm font-medium text-foreground">Provider name</label>
                  <input
                    id="provider-name"
                    ref={firstInputRef}
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    placeholder="My inference server"
                    disabled={isSubmitting}
                    className="h-11 w-full rounded-xl border border-border bg-surface-muted px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                  />
                </div>
              ) : null}

              <div className={`space-y-2 ${schema.showBaseUrl ? '' : 'md:col-span-2'}`}>
                <label htmlFor="provider-api-key" className="text-sm font-medium text-foreground">
                  API key {schema.apiKeyOptional ? '(optional)' : ''}
                </label>
                <div className="relative">
                  <input
                    id="provider-api-key"
                    ref={isCustom ? undefined : firstInputRef}
                    type={isApiKeyVisible ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(event) => {
                      setApiKey(event.target.value)
                      if (warning) setWarning(null)
                    }}
                    placeholder={status?.hasApiKey ? 'Stored locally' : 'Paste API key'}
                    disabled={isSubmitting}
                    className="h-11 w-full rounded-xl border border-border bg-surface-muted px-3 pr-12 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                  />
                  <button
                    type="button"
                    aria-label={isApiKeyVisible ? 'Hide API key' : 'Show API key'}
                    onClick={() => setIsApiKeyVisible((current) => !current)}
                    className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground"
                  >
                    {isApiKeyVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {schema.showBaseUrl ? (
                <div className="space-y-2">
                  <label htmlFor="provider-base-url" className="text-sm font-medium text-foreground">
                    API base URL {schema.baseUrlRequired ? '' : '(optional)'}
                  </label>
                  <input
                    id="provider-base-url"
                    type="url"
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    placeholder={schema.defaultBaseUrl}
                    disabled={isSubmitting}
                    className="h-11 w-full rounded-xl border border-border bg-surface-muted px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                  />
                </div>
              ) : null}

            </div>

            {warning ? (
              <p className="mt-5 rounded-xl border border-border bg-surface-muted px-3 py-2 text-sm text-muted-foreground">{warning}</p>
            ) : null}

            {localError ? (
              <p className="mt-5 rounded-xl border border-danger-border bg-danger-surface px-3 py-2 text-sm text-danger-foreground">{localError}</p>
            ) : null}
          </div>

          <footer className="flex flex-col-reverse gap-2 border-t border-border bg-surface px-4 py-4 md:flex-row md:items-center md:justify-between md:px-6">
            <div>
              {status?.configured && onRemove ? (
                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    void onRemove().catch(() => undefined)
                  }}
                  disabled={isSubmitting}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-danger-border bg-danger-surface px-4 text-sm font-medium text-danger-foreground disabled:opacity-50 md:h-10 md:w-auto"
                >
                  {isCustom ? <Trash2 size={15} /> : <Eraser size={15} />}
                  {isCustom ? 'Remove' : 'Clear'}
                </button>
              ) : null}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="h-11 rounded-xl border border-border bg-surface px-4 text-sm font-medium text-foreground hover:bg-surface-muted disabled:opacity-50 md:h-10"
              >
                Cancel
              </button>
              <button type="submit" disabled={isSubmitting} className={`${PRIMARY_ACTION_BUTTON_CLASS_NAME} h-11 md:h-10`}>
                {isSubmitting ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                {status?.configured ? 'Save changes' : 'Save provider'}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>,
    document.body,
  )
}
