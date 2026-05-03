import type { ChatProviderId, CodexUsageSnapshot, ProvidersState } from '../../types/chat'

export interface CodexUsageSummaryItem {
  label: '5h' | 'Week'
  remainingPercent: number
  resetAfterSeconds: number
  windowKind: 'primary' | 'secondary'
}

export function selectActiveCodexUsageSnapshot(
  providerId: ChatProviderId | null,
  providersState: ProvidersState | null,
  isProvidersLoading: boolean,
): CodexUsageSnapshot | null | undefined {
  if (providerId !== 'codex') {
    return undefined
  }

  if (isProvidersLoading || !providersState) {
    return undefined
  }

  return providersState.codex.accounts.find((account) => account.isActive)?.usage ?? null
}

export function buildCodexUsageSummaryItems(snapshot: CodexUsageSnapshot | null): CodexUsageSummaryItem[] {
  if (!snapshot) {
    return []
  }

  if (snapshot.secondary) {
    const items: CodexUsageSummaryItem[] = []

    items.push({
      label: 'Week',
      remainingPercent: formatRemainingPercent(snapshot.secondary),
      resetAfterSeconds: snapshot.secondary.resetAfterSeconds,
      windowKind: 'secondary',
    })

    if (snapshot.primary) {
      items.push({
        label: '5h',
        remainingPercent: formatRemainingPercent(snapshot.primary),
        resetAfterSeconds: snapshot.primary.resetAfterSeconds,
        windowKind: 'primary',
      })
    }

    return items
  }

  if (snapshot.primary) {
    return [
      {
        label: 'Week',
        remainingPercent: formatRemainingPercent(snapshot.primary),
        resetAfterSeconds: snapshot.primary.resetAfterSeconds,
        windowKind: 'primary',
      },
    ]
  }

  return []
}

export function formatCodexUsageResetCountdown(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }

  return `${minutes}m`
}

function formatRemainingPercent(window: { usedPercent: number }): number {
  const remaining = 100 - window.usedPercent
  return Math.max(0, Math.min(100, Math.round(remaining)))
}
