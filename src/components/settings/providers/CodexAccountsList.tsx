import { Calendar, Clock } from 'lucide-react'
import type { CodexAccountSummary, CodexUsageWindow } from '../../../types/chat'
import { Tooltip } from '../../Tooltip'

interface CodexAccountsListProps {
  accounts: CodexAccountSummary[]
  isBusy: boolean
  onSwitchAccount: (accountKey: string) => Promise<void>
}

function formatRemaining(window: CodexUsageWindow | null): string {
  if (!window) {
    return 'n/a'
  }

  const remaining = 100 - window.usedPercent
  return `${Math.round(remaining)}%`
}

function formatReset(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }

  return `${minutes}m`
}

function getUsageDetail(account: CodexAccountSummary): string {
  if (!account.usage) {
    return 'Usage unavailable'
  }

  const primary = account.usage.primary
    ? `5h ${formatRemaining(account.usage.primary)} (${formatReset(account.usage.primary.resetAfterSeconds)})`
    : '5h n/a'
  const secondary = account.usage.secondary
    ? `Week ${formatRemaining(account.usage.secondary)} (${formatReset(account.usage.secondary.resetAfterSeconds)})`
    : null

  return secondary ? `${primary} • ${secondary}` : primary
}

export function CodexAccountsList({ accounts, isBusy, onSwitchAccount }: CodexAccountsListProps) {
  if (accounts.length === 0) {
    if (isBusy) {
      return (
        <div className="rounded-xl border border-border bg-background px-3 py-3">
          <p className="text-sm text-muted-foreground">Loading Codex accounts…</p>
        </div>
      )
    }

    return (
      <div className="rounded-xl border border-border bg-background px-3 py-3">
        <p className="text-sm text-muted-foreground">No Codex accounts saved yet.</p>
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      {accounts.map((account) => {
        const usageDetail = getUsageDetail(account)
        const canSwitch = !account.isActive
        const baseCardClassName = [
          'flex w-full flex-col gap-3 rounded-xl border px-3 py-3 text-left transition-colors md:flex-row md:items-start md:justify-between',
          account.isActive ? 'border-brand/60 bg-brand-soft' : 'border-border bg-background',
        ].join(' ')
        const clickableCardClassName = `${baseCardClassName} cursor-pointer hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60`

        const content = (
          <>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-medium text-foreground">{account.email ?? account.label}</p>
              </div>
              <p className="mt-1 break-all text-xs text-muted-foreground">{account.accountId}</p>
            </div>

            <div className="flex flex-1 flex-col gap-2 md:items-end">
              <div className="flex flex-wrap items-center justify-between gap-2 md:justify-end">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-[11px] font-medium text-muted-foreground">
                    <Clock size={12} className="-mt-px shrink-0 text-muted-foreground" />
                    <span className="leading-[12px]">5h {formatRemaining(account.usage?.primary ?? null)}</span>
                  </span>
                  {account.usage?.secondary ? (
                    <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-[11px] font-medium text-muted-foreground">
                      <Calendar size={12} className="-mt-px shrink-0 text-muted-foreground" />
                      <span className="leading-[12px]">Week {formatRemaining(account.usage.secondary)}</span>
                    </span>
                  ) : null}
                  {account.isActive ? (
                    <span className="inline-flex h-7 items-center rounded-full border border-brand/50 bg-brand-soft px-3 text-[11px] font-medium text-brand-soft-foreground">
                      <span className="leading-none">active</span>
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          </>
        )

        if (!canSwitch) {
          return (
            <Tooltip key={account.accountKey} content={usageDetail} side="top" fullWidthTrigger>
              <div className={baseCardClassName}>{content}</div>
            </Tooltip>
          )
        }

        return (
          <Tooltip key={account.accountKey} content={usageDetail} side="top" fullWidthTrigger>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void onSwitchAccount(account.accountKey)}
              className={clickableCardClassName}
            >
              {content}
            </button>
          </Tooltip>
        )
      })}
    </div>
  )
}
