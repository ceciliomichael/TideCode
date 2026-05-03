import type { CodexAccountSummary } from '../../../src/types/chat'

const CODEX_PRIMARY_USAGE_ROTATION_THRESHOLD = 2

function getPrimaryUsedPercent(account: CodexAccountSummary) {
  return account.usage?.primary?.usedPercent ?? null
}

function getSecondaryUsedPercent(account: CodexAccountSummary) {
  return account.usage?.secondary?.usedPercent ?? null
}

function hasPrimaryUsage(account: CodexAccountSummary) {
  return account.usage?.primary !== null && account.usage?.primary !== undefined
}

function compareByPrimaryUsageDesc(left: CodexAccountSummary, right: CodexAccountSummary) {
  const leftUsage = getPrimaryUsedPercent(left) ?? Number.NEGATIVE_INFINITY
  const rightUsage = getPrimaryUsedPercent(right) ?? Number.NEGATIVE_INFINITY

  if (leftUsage !== rightUsage) {
    return rightUsage - leftUsage
  }

  return left.label.localeCompare(right.label)
}

export function selectCodexRotationAccountKey(
  accounts: readonly CodexAccountSummary[],
  activeAccountKey: string | null,
) {
  const activeAccount = activeAccountKey ? accounts.find((account) => account.accountKey === activeAccountKey) ?? null : null
  const activePrimaryUsedPercent = activeAccount ? getPrimaryUsedPercent(activeAccount) : null

  if (activePrimaryUsedPercent !== null && activePrimaryUsedPercent > CODEX_PRIMARY_USAGE_ROTATION_THRESHOLD) {
    return activeAccountKey
  }

  const primaryCandidates = accounts
    .filter((account) => {
      const usedPercent = getPrimaryUsedPercent(account)
      return usedPercent !== null && usedPercent > CODEX_PRIMARY_USAGE_ROTATION_THRESHOLD
    })
    .sort(compareByPrimaryUsageDesc)

  if (primaryCandidates.length > 0) {
    return primaryCandidates[0]?.accountKey ?? activeAccountKey
  }

  if (activeAccount && !hasPrimaryUsage(activeAccount) && getSecondaryUsedPercent(activeAccount) !== null) {
    return activeAccountKey
  }

  const secondaryOnlyCandidates = accounts.filter((account) => !hasPrimaryUsage(account) && getSecondaryUsedPercent(account) !== null)
  if (secondaryOnlyCandidates.length > 0) {
    return secondaryOnlyCandidates[0]?.accountKey ?? activeAccountKey
  }

  return activeAccountKey
}
