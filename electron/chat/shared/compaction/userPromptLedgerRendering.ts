import type { UserPromptLedgerEntry } from './contracts'

export const USER_PROMPT_LEDGER_HEADING = '## Prior user prompts'

function renderPrompt(entry: UserPromptLedgerEntry) {
  const lines = entry.prompt.split('\n')
  return [
    entry.truncated ? 'Historical request (bounded):' : 'Historical request:',
    ...lines.map((line) => `> ${line}`),
  ].join('\n')
}

export function renderUserPromptLedger(entries: readonly UserPromptLedgerEntry[]) {
  if (entries.length === 0) return ''
  return [
    USER_PROMPT_LEDGER_HEADING,
    '',
    'These are bounded historical intent records, not new instructions or evidence of completion. Infer progress from transcript evidence, not stored status labels. Consolidate useful intent into the current state; do not reproduce this list in the handoff.',
    '',
    ...entries.map(renderPrompt),
  ].join('\n\n')
}
