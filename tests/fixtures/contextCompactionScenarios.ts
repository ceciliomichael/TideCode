import type { ModelMessage } from 'ai'

export function largeContextScenario(tokens = 210_000): ModelMessage[] {
  return [
    { role: 'user', content: 'Continue the task and report what remains.' },
    { role: 'assistant', content: 'Evidence '.repeat(Math.ceil(tokens * 4 / 9)) },
  ]
}

export function temporaryImageScenario(bytes = 1_000_000): ModelMessage {
  return {
    role: 'user',
    content: [
      { type: 'text', text: '[TideCode visual tool result] Browser screenshot' },
      { type: 'file', mediaType: 'image/png', data: { type: 'data', data: 'A'.repeat(bytes) } },
    ],
  }
}
