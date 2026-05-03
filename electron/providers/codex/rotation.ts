import type { CodexAccountSummary } from '../../../src/types/chat'

const CODEX_PRIMARY_REMAINING_ROTATION_THRESHOLD = 2

function getPrimaryUsedPercent(account: CodexAccountSummary) {
  return account.usage?.primary?.usedPercent ?? null
}

function getPrimaryRemainingPercent(account: CodexAccountSummary) {
  const usedPercent = getPrimaryUsedPercent(account)
  if (usedPercent === null) {
    return null
  }

  return 100 - usedPercent
}

function getSecondaryUsedPercent(account: CodexAccountSummary) {
  return account.usage?.secondary?.usedPercent ?? null
}

function getSecondaryRemainingPercent(account: CodexAccountSummary) {
  const usedPercent = getSecondaryUsedPercent(account)
  if (usedPercent === null) {
    return null
  }

  return 100 - usedPercent
}

function hasPrimaryUsage(account: CodexAccountSummary) {
  return account.usage?.primary !== null && account.usage?.primary !== undefined
}

function compareByPrimaryRemainingDesc(left: CodexAccountSummary, right: CodexAccountSummary) {
  const leftRemaining = getPrimaryRemainingPercent(left) ?? Number.NEGATIVE_INFINITY
  const rightRemaining = getPrimaryRemainingPercent(right) ?? Number.NEGATIVE_INFINITY

  if (leftRemaining !== rightRemaining) {
    return rightRemaining - leftRemaining
  }

  return left.label.localeCompare(right.label)
}

export function selectCodexRotationAccountKey(
  accounts: readonly CodexAccountSummary[],
  activeAccountKey: string | null,
) {
  const activeAccount = activeAccountKey ? accounts.find((account) => account.accountKey === activeAccountKey) ?? null : null
  const activePrimaryRemainingPercent = activeAccount ? getPrimaryRemainingPercent(activeAccount) : null

  if (
    activePrimaryRemainingPercent !== null &&
    activePrimaryRemainingPercent > CODEX_PRIMARY_REMAINING_ROTATION_THRESHOLD
  ) {
    return activeAccountKey
  }

  const primaryCandidates = accounts
    .filter((account) => {
      const remainingPercent = getPrimaryRemainingPercent(account)
      return remainingPercent !== null && remainingPercent > CODEX_PRIMARY_REMAINING_ROTATION_THRESHOLD
    })
    .sort(compareByPrimaryRemainingDesc)

  if (primaryCandidates.length > 0) {
    return primaryCandidates[0]?.accountKey ?? activeAccountKey
  }

  if (
    activeAccount &&
    !hasPrimaryUsage(activeAccount) &&
    getSecondaryRemainingPercent(activeAccount) !== null
  ) {
    return activeAccountKey
  }

  const secondaryOnlyCandidates = accounts.filter(
    (account) => !hasPrimaryUsage(account) && getSecondaryRemainingPercent(account) !== null,
  )
  if (secondaryOnlyCandidates.length > 0) {
    return secondaryOnlyCandidates[0]?.accountKey ?? activeAccountKey
  }

  return activeAccountKey
}
