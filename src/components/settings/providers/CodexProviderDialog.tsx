import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Plus, Unplug, X } from 'lucide-react'
import type { CodexProviderConnectionStatus } from '../../../types/chat'
import { CodexAccountDropdown } from './CodexAccountDropdown'
import { CodexUsagePills } from './CodexUsagePills'
import { PRIMARY_ACTION_BUTTON_CLASS_NAME } from '../shared/actionButtonStyles'

interface CodexProviderDialogProps {
  activeOperation: string | null
  onAddAccount: () => Promise<boolean>
  onClose: () => void
  onConnect: () => Promise<boolean>
  onDisconnect: () => Promise<boolean>
  onRemoveAccount: (accountKey: string) => Promise<boolean>
  onSwitchAccount: (accountKey: string) => Promise<boolean>
  status?: CodexProviderConnectionStatus
}

export function CodexProviderDialog({
  activeOperation,
  onAddAccount,
  onClose,
  onConnect,
  onDisconnect,
  onRemoveAccount,
  onSwitchAccount,
  status,
}: CodexProviderDialogProps) {
  const [localError, setLocalError] = useState<string | null>(null)
  const isBusy = activeOperation?.startsWith('codex:') ?? false
  const isAuthenticated = Boolean(status?.isAuthenticated)
  const activeAccount = status?.accounts.find((account) => account.isActive) ?? status?.accounts[0] ?? null

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isBusy) onClose()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [isBusy, onClose])

  async function runAction(action: () => Promise<boolean>) {
    setLocalError(null)
    try {
      await action()
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Codex action failed.')
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 md:px-4 md:py-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="codex-provider-dialog-title"
        className="flex h-full w-full flex-col overflow-hidden border-border bg-surface md:h-auto md:max-h-[calc(100dvh-3rem)] md:max-w-2xl md:rounded-2xl md:border md:shadow-soft"
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-4 py-4 md:px-6">
          <div>
            <h2 id="codex-provider-dialog-title" className="text-lg font-semibold text-foreground">Codex</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Connect one or more ChatGPT accounts and switch between them whenever you need.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close Codex dialog"
            onClick={onClose}
            disabled={isBusy}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-surface-muted hover:text-foreground disabled:opacity-50 md:h-9 md:w-9"
          >
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
          {isAuthenticated ? (
            <div className="space-y-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h3 className="text-sm font-medium text-foreground">Active account</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Switch accounts without reconnecting your session.</p>
                </div>
                <button
                  type="button"
                  onClick={() => void runAction(onAddAccount)}
                  disabled={isBusy}
                  className={`${PRIMARY_ACTION_BUTTON_CLASS_NAME} w-full md:w-auto`}
                >
                  <Plus size={15} /> Add account
                </button>
              </div>
              <CodexAccountDropdown
                accounts={status?.accounts ?? []}
                disabled={isBusy}
                onSelect={(accountKey) => void runAction(() => onSwitchAccount(accountKey))}
              />
              <CodexUsagePills usage={activeAccount?.usage ?? null} />
            </div>
          ) : (
            <div className="rounded-2xl border border-border bg-surface-muted px-4 py-5">
              <h3 className="text-sm font-medium text-foreground">No Codex account connected</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">Sign in through the browser to load Codex models and usage.</p>
            </div>
          )}
          {localError ? <p className="mt-5 rounded-xl border border-danger-border bg-danger-surface px-3 py-2 text-sm text-danger-foreground">{localError}</p> : null}
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-border px-4 py-4 md:flex-row md:items-center md:justify-between md:px-6">
          <div>
            {isAuthenticated && activeAccount ? (
              <button
                type="button"
                onClick={() => void runAction(() => onRemoveAccount(activeAccount.accountKey))}
                disabled={isBusy}
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-danger-border bg-danger-surface px-4 text-sm font-medium text-danger-foreground disabled:opacity-50 md:h-10 md:w-auto"
              >
                <Unplug size={15} /> Remove account
              </button>
            ) : null}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <button type="button" onClick={onClose} disabled={isBusy} className="h-11 rounded-xl border border-border px-4 text-sm font-medium text-foreground hover:bg-surface-muted disabled:opacity-50 md:h-10">Close</button>
            {isAuthenticated ? (
              <button type="button" onClick={() => void runAction(onDisconnect)} disabled={isBusy} className={PRIMARY_ACTION_BUTTON_CLASS_NAME}>
                {isBusy ? <Loader2 size={15} className="animate-spin" /> : <Unplug size={15} />} Disconnect
              </button>
            ) : (
              <button type="button" onClick={() => void runAction(onConnect)} disabled={isBusy} className={PRIMARY_ACTION_BUTTON_CLASS_NAME}>
                {isBusy ? <Loader2 size={15} className="animate-spin" /> : null} Connect Codex
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
