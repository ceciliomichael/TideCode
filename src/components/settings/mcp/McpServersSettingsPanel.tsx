import { Plus } from 'lucide-react'
import { useState } from 'react'
import { McpServerDialog } from './McpAddDialog'
import { McpServerList } from './McpServerList'
import type { McpAddServerInput, McpServerConfig, McpState } from '../../../types/mcp'
import { SETTINGS_SECTION_TITLE_CLASS_NAME, SettingsPanelLayout } from '../shared/SettingsPanelPrimitives'

const ADD_MCP_BUTTON_CLASS_NAME =
  'provider-primary-action-button inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 text-xs font-medium leading-none transition-colors active:scale-[0.99] disabled:cursor-not-allowed'

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
  const visibleErrorMessage = errorMessage ?? state?.errorMessage
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

  return (
    <SettingsPanelLayout>
      <div className="flex flex-col gap-4">
        <header className="flex flex-col gap-1 px-1 pt-1">
          <h2 className={SETTINGS_SECTION_TITLE_CLASS_NAME}>MCP Servers</h2>
        </header>

        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-6 text-muted-foreground">
              MCP servers expose external tools and data sources to the assistant. New servers are saved globally so
              the same MCP setup is available across your workspaces.
            </p>
          </div>

          <button
            type="button"
            onClick={openAddDialog}
            disabled={isLoading}
            className={`${ADD_MCP_BUTTON_CLASS_NAME} w-full md:w-auto`}
          >
            <Plus className="h-3.5 w-3.5 shrink-0 -mt-px" />
            Add MCP
          </button>
        </div>

        {visibleErrorMessage ? (
          <div className="rounded-2xl border border-danger-border bg-danger-surface px-4 py-3 text-sm text-danger-foreground">
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
