import { Plus } from 'lucide-react'
import { useState } from 'react'
import { toUserFacingErrorMessage } from '../../../lib/userFacingError'
import { McpServerDialog } from './McpAddDialog'
import { McpServerList } from './McpServerList'
import { McpServersSettingsSkeleton } from './McpServersSettingsSkeleton'
import type { McpAddServerInput, McpServerConfig, McpState } from '../../../types/mcp'
import { SETTINGS_SECTION_TITLE_CLASS_NAME, SettingsPanelLayout } from '../shared/SettingsPanelPrimitives'

const ADD_MCP_BUTTON_CLASS_NAME =
  'provider-primary-action-button inline-flex h-11 w-full items-center justify-center gap-2 whitespace-nowrap rounded-xl px-3.5 text-sm font-medium transition-transform active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 md:h-10 md:w-auto'

interface McpServersSettingsPanelProps {
  activeOperation: string | null
  errorMessage: string | null
  isLoading: boolean
  onAddServer: (input: McpAddServerInput) => Promise<boolean>
  onConnectServer: (serverId: string) => Promise<boolean>
  onDisconnectServer: (serverId: string) => Promise<boolean>
  onRemoveServer: (serverId: string) => Promise<boolean>
  onToggleTool: (serverId: string, toolName: string, enabled: boolean) => Promise<boolean>
  onUpdateServer: (serverId: string, input: McpAddServerInput) => Promise<boolean>
  state: McpState | null
}

interface McpServerDialogState {
  mode: 'add' | 'edit'
  server: McpServerConfig | null
}

export function McpServersSettingsPanel({
  activeOperation,
  errorMessage,
  isLoading,
  onAddServer,
  onConnectServer,
  onDisconnectServer,
  onRemoveServer,
  onToggleTool,
  onUpdateServer,
  state,
}: McpServersSettingsPanelProps) {
  const [dialogState, setDialogState] = useState<McpServerDialogState | null>(null)
  const configs = state?.configs ?? []
  const statuses = state?.statuses ?? {}
  const rawErrorMessage = errorMessage ?? state?.errorMessage ?? null
  const visibleErrorMessage = rawErrorMessage
    ? toUserFacingErrorMessage(rawErrorMessage, 'Unable to update MCP servers.')
    : null
  const isSubmitting = (activeOperation?.startsWith('add:') ?? false) || (activeOperation?.startsWith('update:') ?? false)

  function openAddDialog() {
    setDialogState({
      mode: 'add',
      server: null,
    })
  }

  function openEditDialog(config: McpServerConfig) {
    setDialogState({
      mode: 'edit',
      server: config,
    })
  }

  function closeDialog() {
    setDialogState(null)
  }

  if (isLoading && state === null && visibleErrorMessage === null) {
    return <McpServersSettingsSkeleton />
  }

  return (
    <SettingsPanelLayout>
      <div className="flex flex-col gap-4">
        <header className="flex flex-col gap-1 px-1 pt-1">
          <h2 className={SETTINGS_SECTION_TITLE_CLASS_NAME}>MCP Servers</h2>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <p className="min-w-0 flex-1 text-sm leading-6 text-muted-foreground">
              MCP servers expose external tools and data sources to the assistant. New servers are saved globally so
              the same MCP setup is available across your workspaces.
            </p>
            <button
              type="button"
              onClick={openAddDialog}
              disabled={isLoading}
              className={`${ADD_MCP_BUTTON_CLASS_NAME} md:shrink-0`}
            >
              <Plus size={15} /> Add MCP
            </button>
          </div>
        </header>

        {visibleErrorMessage ? (
          <div className="rounded-xl border border-danger-border bg-danger-surface px-4 py-3 text-sm text-danger-foreground">
            {visibleErrorMessage}
          </div>
        ) : null}

        <McpServerList
          activeOperation={activeOperation}
          configs={configs}
          onConnect={onConnectServer}
          onDisconnect={onDisconnectServer}
          onEdit={openEditDialog}
          onRemove={onRemoveServer}
          onToggleTool={onToggleTool}
          statuses={statuses}
        />
      </div>

      {dialogState ? (
        <McpServerDialog
          key={`${dialogState.mode}:${dialogState.server?.id ?? 'new'}`}
          errorMessage={visibleErrorMessage ?? null}
          initialServer={dialogState.server}
          isSubmitting={isSubmitting}
          mode={dialogState.mode}
          onClose={closeDialog}
          onSubmit={async (input) => {
            const didSubmit =
              dialogState.mode === 'edit' && dialogState.server
                ? await onUpdateServer(dialogState.server.id, input)
                : await onAddServer(input)

            if (didSubmit) {
              closeDialog()
            }

            return didSubmit
          }}
        />
      ) : null}
    </SettingsPanelLayout>
  )
}
