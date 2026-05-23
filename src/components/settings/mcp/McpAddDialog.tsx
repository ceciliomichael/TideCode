import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Plus, Save, X } from 'lucide-react'
import { DropdownField, type DropdownOption } from '../../ui/DropdownField'
import { PRIMARY_ACTION_BUTTON_CLASS_NAME } from '../shared/actionButtonStyles'
import { LineNumberedTextarea } from '../shared/LineNumberedTextarea'
import type {
  McpAddServerInput,
  McpAddServerTransportType,
  McpServerConfig,
} from '../../../types/mcp'

interface McpServerDialogProps {
  errorMessage: string | null
  initialServer?: McpServerConfig | null
  isSubmitting: boolean
  mode: 'add' | 'edit'
  onClose: () => void
  onSubmit: (input: McpAddServerInput) => Promise<boolean>
}

interface McpServerFormState {
  argsText: string
  command: string
  envText: string
  headersText: string
  serverName: string
  serverType: McpAddServerTransportType
  url: string
}

const TYPE_OPTIONS: readonly DropdownOption[] = [
  { label: 'Stdio', value: 'stdio' },
  { label: 'Streamable HTTP', value: 'streamable-http' },
] as const

function createEmptyFormState(): McpServerFormState {
  return {
    argsText: '',
    command: '',
    envText: '',
    headersText: '',
    serverName: '',
    serverType: 'stdio',
    url: '',
  }
}

function formatTextList(values?: string[]) {
  return values?.join('\n') ?? ''
}

function formatKeyValueLines(values?: Record<string, string>) {
  return Object.entries(values ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
}

function createFormStateFromServer(server?: McpServerConfig | null): McpServerFormState {
  if (!server) {
    return createEmptyFormState()
  }

  return {
    argsText: formatTextList(server.args),
    command: server.command ?? '',
    envText: formatKeyValueLines(server.env),
    headersText: formatKeyValueLines(server.headers),
    serverName: server.name,
    serverType: server.type,
    url: server.url ?? '',
  }
}

function parseTextList(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function parseKeyValueLines(value: string) {
  const result: Record<string, string> = {}
  const lines = value.split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) {
      continue
    }

    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex <= 0) {
      throw new Error('Entries must use KEY=value format.')
    }

    const key = trimmed.slice(0, separatorIndex).trim()
    const entryValue = trimmed.slice(separatorIndex + 1).trim()
    if (key.length === 0 || entryValue.length === 0) {
      throw new Error('Entries must use KEY=value format.')
    }

    result[key] = entryValue
  }

  return result
}

function getDialogCopy(mode: McpServerDialogProps['mode']) {
  return mode === 'add'
    ? {
        actionLabel: 'Add MCP',
        description:
          'Add one server at a time. Stdio is for local subprocesses. Streamable HTTP is for remote servers.',
        title: 'Add MCP',
      }
    : {
        actionLabel: 'Save changes',
        description: 'Edit the existing MCP server entry without changing where it is managed from.',
        title: 'Edit MCP',
      }
}

export function McpServerDialog({
  errorMessage,
  initialServer,
  isSubmitting,
  mode,
  onClose,
  onSubmit,
}: McpServerDialogProps) {
  const [formState, setFormState] = useState(() => createFormStateFromServer(initialServer))
  const [localError, setLocalError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement | null>(null)
  const dialogCopy = getDialogCopy(mode)

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isSubmitting) {
        onClose()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [isSubmitting, onClose])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLocalError(null)

    const normalizedServerName = formState.serverName.trim()
    if (normalizedServerName.length === 0) {
      setLocalError('Server name is required.')
      return
    }

    try {
      const normalizedCommand = formState.command.trim()
      const normalizedUrl = formState.url.trim()
      const input: McpAddServerInput =
        formState.serverType === 'stdio'
          ? {
              args: parseTextList(formState.argsText),
              command: normalizedCommand,
              env: parseKeyValueLines(formState.envText),
              saveScope: 'global',
              serverName: normalizedServerName,
              type: formState.serverType,
            }
          : {
              headers: parseKeyValueLines(formState.headersText),
              saveScope: 'global',
              serverName: normalizedServerName,
              type: formState.serverType,
              url: normalizedUrl,
            }

      if (formState.serverType === 'stdio' && normalizedCommand.length === 0) {
        setLocalError('Command is required for stdio servers.')
        return
      }

      if (formState.serverType === 'streamable-http' && normalizedUrl.length === 0) {
        setLocalError('URL is required for streamable HTTP servers.')
        return
      }

      const didSubmit = await onSubmit(input)
      if (!didSubmit) {
        return
      }

      setFormState(createEmptyFormState())
      onClose()
    } catch (error) {
      setLocalError(
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : mode === 'add'
            ? 'Unable to add the MCP server.'
            : 'Unable to save the MCP server.',
      )
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/12 px-4 py-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) {
          onClose()
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcp-server-dialog-title"
        className="flex h-[min(42rem,calc(100dvh-2rem))] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-soft"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-6 pt-5 pb-3">
          <div className="min-w-0">
            <h2 id="mcp-server-dialog-title" className="text-lg font-semibold text-foreground">
              {dialogCopy.title}
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{dialogCopy.description}</p>
          </div>

          <button
            type="button"
            aria-label={`Close ${dialogCopy.title} dialog`}
            onClick={onClose}
            disabled={isSubmitting}
            className="inline-flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={(event) => void handleSubmit(event)} className="min-h-0 flex-1 flex flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="mcp-server-name" className="text-sm font-medium text-foreground">
                  Server name
                </label>
                <input
                  id="mcp-server-name"
                  ref={nameRef}
                  type="text"
                  value={formState.serverName}
                  onChange={(event) => setFormState((current) => ({ ...current, serverName: event.target.value }))}
                  placeholder="my-local-server"
                  className="h-11 w-full rounded-xl border border-border bg-surface-muted px-3 text-sm text-foreground placeholder:text-muted-foreground outline-none"
                  disabled={isSubmitting}
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="mcp-server-type" className="text-sm font-medium text-foreground">
                  Type
                </label>
                <DropdownField
                  id="mcp-server-type"
                  ariaLabel="MCP server type"
                  className="w-full"
                  triggerClassName="chat-runtime-control-trigger h-11 w-full justify-between rounded-xl border-border bg-surface-muted px-3 text-sm text-foreground shadow-none hover:bg-[var(--dropdown-control-hover-surface)] hover:border-[var(--dropdown-control-hover-border)]"
                  disabled={isSubmitting}
                  value={formState.serverType}
                  onChange={(value) =>
                    setFormState((current) => ({
                      ...current,
                      serverType: value as McpAddServerTransportType,
                    }))
                  }
                  options={TYPE_OPTIONS}
                />
              </div>
            </div>

            <div className="mt-4 space-y-4">
              {formState.serverType === 'stdio' ? (
                <>
                  <div className="space-y-2">
                    <label htmlFor="mcp-command" className="text-sm font-medium text-foreground">
                      Command
                    </label>
                    <input
                      id="mcp-command"
                      type="text"
                      value={formState.command}
                      onChange={(event) => setFormState((current) => ({ ...current, command: event.target.value }))}
                      placeholder="node"
                      className="h-11 w-full rounded-xl border border-border bg-surface-muted px-3 text-sm text-foreground placeholder:text-muted-foreground outline-none"
                      disabled={isSubmitting}
                    />
                    <p className="text-xs leading-5 text-muted-foreground">
                      This is the executable used to launch the local MCP process.
                    </p>
                  </div>

                  <LineNumberedTextarea
                    id="mcp-args"
                    label="Arguments"
                    value={formState.argsText}
                    onChange={(value) => setFormState((current) => ({ ...current, argsText: value }))}
                    placeholder="/path/to/server.js"
                    disabled={isSubmitting}
                    rows={4}
                    showLineNumbers={false}
                    description="Put one argument per line. Long entries wrap naturally."
                  />

                  <LineNumberedTextarea
                    id="mcp-env"
                    label="Environment"
                    value={formState.envText}
                    onChange={(value) => setFormState((current) => ({ ...current, envText: value }))}
                    placeholder="API_KEY=your-api-key"
                    disabled={isSubmitting}
                    rows={4}
                    showLineNumbers={false}
                    description="Put one KEY=value pair per line."
                  />
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <label htmlFor="mcp-url" className="text-sm font-medium text-foreground">
                      URL
                    </label>
                    <input
                      id="mcp-url"
                      type="url"
                      value={formState.url}
                      onChange={(event) => setFormState((current) => ({ ...current, url: event.target.value }))}
                      placeholder="https://example.com/mcp"
                      className="h-11 w-full rounded-xl border border-border bg-surface-muted px-3 text-sm text-foreground placeholder:text-muted-foreground outline-none"
                      disabled={isSubmitting}
                    />
                    <p className="text-xs leading-5 text-muted-foreground">This is the remote MCP endpoint.</p>
                  </div>

                  <LineNumberedTextarea
                    id="mcp-headers"
                    label="Headers"
                    value={formState.headersText}
                    onChange={(value) => setFormState((current) => ({ ...current, headersText: value }))}
                    placeholder="Authorization=Bearer your-token"
                    disabled={isSubmitting}
                    rows={4}
                    showLineNumbers={false}
                    description="Put one KEY=value pair per line."
                  />
                </>
              )}
            </div>

            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              Typical MCP usage is either a local process launched with stdio or a remote hosted server over streamable
              HTTP. Keep the server name short and unique so it is easy to recognize in the settings list.
            </p>

            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              This form writes a single literal server entry to your global `mcp.json`.
            </p>

            {localError || errorMessage ? (
              <div className="mt-4 rounded-xl border border-danger-border bg-danger-surface px-4 py-3 text-sm text-danger-foreground">
                {errorMessage ?? localError}
              </div>
            ) : null}
          </div>

          <div className="shrink-0 border-t border-border bg-surface px-6 py-4">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-border bg-surface-muted px-3.5 text-sm font-medium text-foreground transition-colors hover:bg-border-muted disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button type="submit" disabled={isSubmitting} className={`${PRIMARY_ACTION_BUTTON_CLASS_NAME} h-10`}>
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : mode === 'add' ? (
                  <Plus className="h-4 w-4" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {dialogCopy.actionLabel}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}

export { McpServerDialog as McpAddDialog }
