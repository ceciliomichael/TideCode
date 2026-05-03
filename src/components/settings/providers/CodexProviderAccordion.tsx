import { Plus, Unplug } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { CodexProviderConnectionStatus } from '../../../types/chat'
import { CodexAccountDropdown } from './CodexAccountDropdown'
import { CodexUsagePills } from './CodexUsagePills'
import { ProviderAccordionItem } from './ProviderAccordionItem'

interface CodexProviderAccordionProps {
  activeOperation: string | null
  isBusy: boolean
  isExpanded: boolean
  isFirst?: boolean
  onAddAccount: () => Promise<void>
  onConnect: () => Promise<void>
  onDisconnect: () => Promise<void>
  onSwitchAccount: (accountKey: string) => Promise<void>
  onToggle: () => void
  providerStatus: CodexProviderConnectionStatus | undefined
  primaryButtonClassName: string
}

export function CodexProviderAccordion({
  activeOperation,
  isBusy,
  isExpanded,
  isFirst = false,
  onAddAccount,
  onConnect,
  onDisconnect,
  onSwitchAccount,
  onToggle,
  providerStatus,
  primaryButtonClassName,
}: CodexProviderAccordionProps) {
  const [isActionPending, setIsActionPending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const status = providerStatus
  const isAuthenticated = Boolean(status?.isAuthenticated)
  const activeAccount = status?.accounts.find((account) => account.isActive) ?? status?.accounts[0] ?? null
  const isConnecting = activeOperation === 'codex:connect'
  const isAddingAccount = activeOperation === 'codex:add-account'
  const isDisconnecting = activeOperation === 'codex:disconnect'
  const isSwitchingAccount = activeOperation?.startsWith('codex:switch:') ?? false
  const statusLabel = isAuthenticated ? 'Connected' : 'Not Connected'
  const resolvedDescription = isAuthenticated
    ? 'Connected with OAuth. Select which account should be active for Codex requests.'
    : 'Connect your local ChatGPT/Codex OAuth session and use Codex models without an API key.'

  const accountCountLabel = useMemo(() => {
    const totalAccounts = status?.accounts.length ?? 0
    return `${totalAccounts} account${totalAccounts === 1 ? '' : 's'}`
  }, [status?.accounts.length])

  async function runAction(action: () => Promise<void>) {
    setActionError(null)
    setIsActionPending(true)

    try {
      await action()
    } catch (error) {
      const message = error instanceof Error && error.message.trim().length > 0 ? error.message : 'Provider action failed.'
      setActionError(message)
    } finally {
      setIsActionPending(false)
    }
  }

  return (
    <ProviderAccordionItem
      title="Codex"
      description={resolvedDescription}
      statusLabel={statusLabel}
      statusTone={isAuthenticated ? 'active' : 'inactive'}
      isExpanded={isExpanded}
      isFirst={isFirst}
      onToggle={onToggle}
      actions={null}
    >
      <div className="space-y-4">
        {isAuthenticated ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-foreground">Account</p>
                <p className="mt-1 text-xs text-muted-foreground">{accountCountLabel}. Select the email to switch instantly.</p>
              </div>
              <button
                type="button"
                onClick={() => void runAction(onAddAccount)}
                disabled={isBusy || isActionPending || isAddingAccount}
                className={primaryButtonClassName}
              >
                <Plus size={15} />
                {isAddingAccount ? 'Adding…' : 'Add Account'}
              </button>
            </div>

              <CodexAccountDropdown
              accounts={status?.accounts ?? []}
              disabled={isBusy || isActionPending || isSwitchingAccount}
              onSelect={(accountKey) => {
                void runAction(() => onSwitchAccount(accountKey))
              }}
            />
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-surface-muted px-4 py-4 text-sm text-muted-foreground">
            No active Codex session is configured. Connect once to load your available Codex accounts.
          </div>
        )}

        {actionError ? (
          <p className="rounded-xl border border-danger-border bg-danger-surface px-3 py-2 text-sm text-danger-foreground">
            {actionError}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          {isAuthenticated ? <CodexUsagePills usage={activeAccount?.usage ?? null} /> : null}
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {isAuthenticated ? (
              <button
                type="button"
                onClick={() => void runAction(onDisconnect)}
                disabled={isBusy || isActionPending || isDisconnecting}
                className={primaryButtonClassName}
              >
                <Unplug size={15} />
                Disconnect
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void runAction(onConnect)}
                disabled={isBusy || isActionPending || isConnecting}
                className={primaryButtonClassName}
              >
                {isConnecting ? 'Connecting…' : 'Connect Codex'}
              </button>
            )}
          </div>
        </div>
      </div>
    </ProviderAccordionItem>
  )
}
