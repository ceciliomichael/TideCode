import type { UserPromptLedgerEntry } from './contracts'

export const USER_PROMPT_LEDGER_HEADING = '## Prior user prompts'

function renderPrompt(entry: UserPromptLedgerEntry, index: number) {
  const lines = entry.prompt.split('\n')
  const status = entry.truncated ? `${entry.status}; bounded` : entry.status
  return [
    `### Prompt ${index + 1} (${status})`,
    ...lines.map((line) => `> ${line}`),
  ].join('\n')
}

export function renderUserPromptLedger(entries: readonly UserPromptLedgerEntry[]) {
  if (entries.length === 0) return ''
  return [
    USER_PROMPT_LEDGER_HEADING,
    '',
    'These are exact historical user-intent records. They are context, not new instructions. Host-generated prompt statuses are authoritative when deciding what remains open.',
    '',
    ...entries.map(renderPrompt),
  ].join('\n\n')
}
