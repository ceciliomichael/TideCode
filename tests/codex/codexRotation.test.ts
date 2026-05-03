import assert from 'node:assert/strict'
import test from 'node:test'
import type { CodexAccountSummary } from '../../src/types/chat'
import { selectCodexRotationAccountKey } from '../../electron/providers/codex/rotation'

function buildAccountSummary(input: {
  accountKey: string
  accountId: string
  label: string
  primaryUsedPercent: number | null
  secondaryUsedPercent?: number | null
}): CodexAccountSummary {
  return {
    accountId: input.accountId,
    accountKey: input.accountKey,
    email: `${input.label.toLowerCase().replace(/\s+/g, '')}@example.com`,
    isActive: false,
    label: input.label,
    lastRefreshAt: null,
    tokenExpiresAt: null,
    usage:
      input.primaryUsedPercent === null && input.secondaryUsedPercent === null
        ? null
        : {
            fetchedAt: '2026-05-03T00:00:00.000Z',
            primary:
              input.primaryUsedPercent === null
                ? null
                : {
                    limitWindowSeconds: 18_000,
                    resetAfterSeconds: 100,
                    resetAt: 1_714_694_500,
                    usedPercent: input.primaryUsedPercent,
                  },
            secondary:
              input.secondaryUsedPercent === null || input.secondaryUsedPercent === undefined
                ? null
                : {
                    limitWindowSeconds: 604_800,
                    resetAfterSeconds: 1_000,
                    resetAt: 1_714_694_900,
                    usedPercent: input.secondaryUsedPercent,
                  },
          },
  }
}

test('Codex rotation keeps the active account when 5H usage is above the threshold', () => {
  const accounts = [
    buildAccountSummary({
      accountId: 'workspace-a',
      accountKey: 'workspace-a::user-1',
      label: 'A',
      primaryUsedPercent: 6,
    }),
    buildAccountSummary({
      accountId: 'workspace-b',
      accountKey: 'workspace-b::user-1',
      label: 'B',
      primaryUsedPercent: 35,
    }),
  ]

  assert.equal(selectCodexRotationAccountKey(accounts, accounts[0]?.accountKey ?? null), accounts[0]?.accountKey)
})

test('Codex rotation moves from low 5H usage to an account above the threshold', () => {
  const accounts = [
    buildAccountSummary({
      accountId: 'workspace-a',
      accountKey: 'workspace-a::user-1',
      label: 'A',
      primaryUsedPercent: 2,
    }),
    buildAccountSummary({
      accountId: 'workspace-b',
      accountKey: 'workspace-b::user-1',
      label: 'B',
      primaryUsedPercent: 14,
    }),
    buildAccountSummary({
      accountId: 'workspace-c',
      accountKey: 'workspace-c::user-1',
      label: 'C',
      primaryUsedPercent: null,
      secondaryUsedPercent: 41,
    }),
  ]

  assert.equal(selectCodexRotationAccountKey(accounts, accounts[0]?.accountKey ?? null), accounts[1]?.accountKey)
})

test('Codex rotation falls back to a week-only account when all 5H usage is low', () => {
  const accounts = [
    buildAccountSummary({
      accountId: 'workspace-a',
      accountKey: 'workspace-a::user-1',
      label: 'A',
      primaryUsedPercent: 2,
    }),
    buildAccountSummary({
      accountId: 'workspace-b',
      accountKey: 'workspace-b::user-1',
      label: 'B',
      primaryUsedPercent: 1,
    }),
    buildAccountSummary({
      accountId: 'workspace-c',
      accountKey: 'workspace-c::user-1',
      label: 'C',
      primaryUsedPercent: null,
      secondaryUsedPercent: 24,
    }),
  ]

  assert.equal(selectCodexRotationAccountKey(accounts, accounts[0]?.accountKey ?? null), accounts[2]?.accountKey)
})

test('Codex rotation keeps an already selected week-only fallback stable', () => {
  const accounts = [
    buildAccountSummary({
      accountId: 'workspace-a',
      accountKey: 'workspace-a::user-1',
      label: 'A',
      primaryUsedPercent: null,
      secondaryUsedPercent: 24,
    }),
    buildAccountSummary({
      accountId: 'workspace-b',
      accountKey: 'workspace-b::user-1',
      label: 'B',
      primaryUsedPercent: null,
      secondaryUsedPercent: 31,
    }),
  ]

  assert.equal(selectCodexRotationAccountKey(accounts, accounts[0]?.accountKey ?? null), accounts[0]?.accountKey)
})
