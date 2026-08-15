const TOOL_ACTIONS = new Set([
  'Activated',
  'Completed',
  'Created',
  'Deleted',
  'Edited',
  'Forgot',
  'Interacted',
  'Kept',
  'Listed',
  'Read',
  'Recorded',
  'Ran',
  'Searched',
  'Started',
  'Terminated',
  'Updated',
  'Verified',
])

export interface TerminalToolLabelParts {
  action: string
  subject: string
}

export function splitTerminalToolLabel(label: string): TerminalToolLabelParts {
  const normalizedLabel = label.trim()
  const words = normalizedLabel.split(/\s+/u)
  const failedWordIndex = words.findIndex((word) => word.toLowerCase() === 'failed')

  if (failedWordIndex >= 0) {
    return {
      action: words.slice(0, failedWordIndex).join(' ') || 'Tool',
      subject: words.slice(failedWordIndex + 1).join(' '),
    }
  }

  const separatorIndex = normalizedLabel.indexOf(' ')
  const firstWord = separatorIndex < 0 ? normalizedLabel : normalizedLabel.slice(0, separatorIndex)

  if (TOOL_ACTIONS.has(firstWord)) {
    return {
      action: firstWord,
      subject: separatorIndex < 0 ? '' : normalizedLabel.slice(separatorIndex + 1).trim(),
    }
  }

  return {
    action: 'Tool',
    subject: normalizedLabel,
  }
}
