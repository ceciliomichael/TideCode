import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeConversationRecord } from '../electron/history/documents'

test('history normalization preserves genuine image read presentations', () => {
  const normalized = normalizeConversationRecord({
    agentContextRootPath: 'C:/workspace',
    createdAt: 1,
    id: 'conversation-1',
    messages: [{
      content: '',
      id: 'assistant-1',
      role: 'assistant',
      timestamp: 2,
      toolInvocations: [{
        argumentsText: '{"path":"@attachments/portrait.png"}',
        id: 'read-1',
        resultPresentation: {
          fileName: 'portrait.png',
          kind: 'image',
          mediaType: 'image/png',
          relativePath: '@attachments/portrait.png',
        },
        startedAt: 2,
        state: 'completed',
        toolName: 'read',
      }],
    }],
    title: 'Image read',
    updatedAt: 2,
  })

  assert.equal(normalized.messages[0]?.toolInvocations?.[0]?.resultPresentation?.kind, 'image')
})
