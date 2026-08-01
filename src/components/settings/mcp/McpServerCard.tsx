import { ChevronDown, ChevronUp, PencilLine, Power, Server, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { McpServerConfig, McpServerStatus } from '../../../types/mcp'
import { McpRemoveDialog } from './McpRemoveDialog'

interface McpServerCardProps {
  config: McpServerConfig
  onConnect: (serverId: string) => Promise<boolean>
  onDisconnect: (serverId: string) => Promise<boolean>
  onEdit: (config: McpServerConfig) => void
  onRemove: (serverId: string) => Promise<boolean>
  onToggleTool: (serverId: string, toolName: string, enabled: boolean) => Promise<boolean>
  status?: McpServerStatus
  activeOperation: string | null
}

function getStatusLabel(status?: McpServerStatus) {
  switch (status?.status) {
    case 'connected':
      return 'Connected'
    case 'connecting':
      return 'Connecting'
    case 'error':
      return 'Error'
    default:
      return 'Disconnected'
  }
}

function getStatusColor(status?: McpServerStatus) {
  switch (status?.status) {
    case 'connected':
      return 'bg-emerald-500'
    case 'connecting':
      return 'bg-amber-500'
    case 'error':
      return 'bg-red-500'
    default:
      return 'bg-neutral-400'
  }
}

function isToolEnabled(config: McpServerConfig, toolName: string) {
  const allowedTools = config.toolConfiguration?.allowedTools ?? []
  const disabledTools = config.toolConfiguration?.disabledTools ?? []

  if (allowedTools.length > 0) {
    return allowedTools.includes(toolName) && !disabledTools.includes(toolName)
  }

  return !disabledTools.includes(toolName)
}

export function McpServerCard({
  activeOperation,
  config,
  onConnect,
  onDisconnect,
  onEdit,
  onRemove,
  onToggleTool,
  status,
}: McpServerCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isRemoveConfirmationOpen, setIsRemoveConfirmationOpen] = useState(false)
  const isConnected = status?.status === 'connected'
  const isConnecting = status?.status === 'connecting'
  const isRemoveBusy = activeOperation === `remove:${config.id}`
  const isUpdateBusy = activeOperation === `update:${config.id}`
  const isBusy =
    activeOperation === `connect:${config.id}` ||
    activeOperation === `disconnect:${config.id}` ||
    isRemoveBusy ||
    isUpdateBusy
  const isToolBusy = activeOperation?.startsWith(`toggle:${config.id}:`) ?? false
  const toolCount = status?.tools?.length ?? 0
  const isReadOnly = config.isReadOnly

  const statusColor = getStatusColor(status)

  async function handleRemove() {
    const didRemove = await onRemove(config.id)
    if (didRemove) {
      setIsRemoveConfirmationOpen(false)
    }
  }

  const connectionLabel = isConnecting ? 'Connecting...' : isConnected ? 'Disconnect' : 'Connect'

  return (
    <article className="flex min-w-0 flex-col gap-3 overflow-hidden rounded-xl border border-border bg-surface p-4">
      <div className="flex min-w-0 items-start justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="shrink-0 rounded-lg bg-surface-muted p-2">
            <Server className="h-5 w-5 text-foreground" />
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h3 className="break-words text-sm font-medium text-foreground">{config.name}</h3>
            {config.description ? <p className="break-words text-xs text-muted-foreground">{config.description}</p> : null}
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className={['h-2 w-2 rounded-full', statusColor].join(' ')} />
              <span className="text-xs text-muted-foreground">{getStatusLabel(status)}</span>
              {isConnected ? <span className="text-xs text-muted-foreground">• {toolCount} tools</span> : null}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <button
            type="button"
            onClick={() => (isConnected ? void onDisconnect(config.id) : void onConnect(config.id))}
            disabled={isConnecting || !config.enabled || isBusy}
            className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-xl border px-2.5 text-xs font-medium leading-none transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              backgroundColor: 'var(--color-brand-action)',
              borderColor: 'transparent',
              color: '#fff',
            }}
          >
            <Power className="block h-3.5 w-3.5 shrink-0 self-center" />
            <span className="relative top-px flex items-center leading-none">{connectionLabel}</span>
          </button>
        </div>
      </div>

      {status?.error ? (
        <div
          className="rounded-lg border border-danger-border bg-danger-surface px-3 py-2 text-xs break-words overflow-hidden text-danger-foreground"
        >
          {status.error}
        </div>
      ) : null}

      <div className="flex items-end justify-between gap-3">
        <button
          type="button"
          onClick={() => setIsExpanded((currentValue) => !currentValue)}
          className="inline-flex h-7 shrink-0 items-end gap-1 self-end pb-0.5 text-xs leading-none text-muted-foreground hover:opacity-80"
        >
          {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {isExpanded ? 'Hide details' : 'Show details'}
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsRemoveConfirmationOpen((currentValue) => !currentValue)}
            disabled={isBusy || isReadOnly}
            className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-danger-border bg-danger-surface px-2.5 text-xs font-medium leading-none text-danger-foreground transition-colors hover:text-danger-foreground-hover disabled:cursor-not-allowed disabled:opacity-50"
                    title={isReadOnly ? 'This server is managed outside TideCode.' : undefined}
          >
            <Trash2 className="block h-3.5 w-3.5 shrink-0 self-center" />
            <span className="relative top-px flex items-center leading-none">Remove</span>
          </button>

          <button
            type="button"
            onClick={() => onEdit(config)}
            disabled={isBusy || isReadOnly}
            className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-xl border px-2.5 text-xs font-medium leading-none transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              backgroundColor: 'var(--color-brand-action)',
              borderColor: 'transparent',
              color: '#fff',
            }}
            title={isReadOnly ? 'This server is managed outside TideCode.' : undefined}
          >
            <PencilLine className="block h-3.5 w-3.5 shrink-0 self-center" />
            <span className="relative top-px flex items-center leading-none">Edit</span>
          </button>
        </div>
      </div>

      {isRemoveConfirmationOpen ? (
        <McpRemoveDialog
          isSubmitting={isRemoveBusy}
          onClose={() => setIsRemoveConfirmationOpen(false)}
          onConfirm={() => void handleRemove()}
          serverName={config.name}
        />
      ) : null}

      {isExpanded ? (
        <div className="flex min-w-0 flex-col gap-2 border-t border-border pt-2 text-xs text-muted-foreground">
          {isReadOnly ? (
            <div className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
              Imported from another app. Connect and inspect it here, but edit or remove it in the owning app’s
              `mcp.json`.
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <span className="shrink-0">Type:</span>
            <span className="rounded px-2 py-0.5 text-xs font-medium bg-surface-muted text-foreground">
              {config.type.toUpperCase()}
            </span>
          </div>

          {config.type === 'stdio' ? (
            <>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="shrink-0">Command:</span>
                <code className="w-full overflow-hidden rounded-md bg-surface-muted px-2 py-1 break-all">
                  {config.command ?? 'Not configured'}
                </code>
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <span className="shrink-0">Args:</span>
                <code className="w-full overflow-hidden rounded-md bg-surface-muted px-2 py-1 whitespace-pre-wrap break-words">
                  {config.args && config.args.length > 0 ? config.args.join(' ') : 'None'}
                </code>
              </div>
            </>
          ) : (
            <div className="flex min-w-0 flex-col gap-1">
              <span className="shrink-0">URL:</span>
              <code className="w-full overflow-hidden rounded-md bg-surface-muted px-2 py-1 break-all">
                {config.url ?? 'Not configured'}
              </code>
            </div>
          )}

          {isConnected ? (
            <div className="mt-2 border-t border-border pt-2">
              <p className="mb-2 text-xs font-medium text-foreground">
                Available Tools ({toolCount})
              </p>

              {status?.tools && status.tools.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {status.tools.map((tool) => {
                    const enabled = isToolEnabled(config, tool.name)

                    return (
                      <button
                        key={tool.name}
                        type="button"
                        aria-pressed={enabled}
                        onClick={() => void onToggleTool(config.id, tool.name, !enabled)}
                        disabled={isToolBusy || isBusy || isReadOnly}
                        className={[
                          'rounded-lg border px-3 py-1 text-xs font-medium transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60',
                          enabled ? '' : '',
                        ].join(' ')}
                        style={{
                          backgroundColor: enabled ? 'var(--color-brand-action)' : 'var(--color-surface-muted)',
                          borderColor: enabled ? 'var(--color-brand-action)' : 'transparent',
                          color: enabled ? '#fff' : 'var(--color-muted-foreground)',
                        }}
                        title={
                          isReadOnly
                            ? `${tool.description ?? tool.name} (managed outside TideCode)`
                            : `${tool.description ?? tool.name} (${enabled ? 'click to disable' : 'click to enable'})`
                        }
                      >
                        {tool.name}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No tools found on this server.</p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}
