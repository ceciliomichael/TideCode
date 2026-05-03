import { useMemo } from 'react'
import type { CodexAccountSummary } from '../../../types/chat'
import { DropdownField, type DropdownOption } from '../../ui/DropdownField'

interface CodexAccountDropdownProps {
  accounts: readonly CodexAccountSummary[]
  disabled?: boolean
  onSelect: (accountKey: string) => void
}

function getAccountLabel(account: CodexAccountSummary) {
  const baseLabel = account.email ?? account.label ?? account.accountId
  return `${baseLabel} (${account.accountId})`
}

export function CodexAccountDropdown({ accounts, disabled = false, onSelect }: CodexAccountDropdownProps) {
  const selectedAccountKey = useMemo(
    () => accounts.find((account) => account.isActive)?.accountKey ?? accounts[0]?.accountKey ?? '',
    [accounts],
  )

  const options = useMemo<DropdownOption[]>(
    () =>
      accounts.map((account) => ({
        label: getAccountLabel(account),
        value: account.accountKey,
      })),
    [accounts],
  )

  return (
    <DropdownField
      ariaLabel="Codex account"
      className="w-full"
      disabled={disabled || options.length === 0}
      onChange={onSelect}
      options={options}
      value={selectedAccountKey}
    />
  )
}
