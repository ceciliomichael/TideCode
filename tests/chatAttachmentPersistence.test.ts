import assert from 'node:assert/strict'
import test from 'node:test'
import { persistStagedChatImages } from '../src/lib/chatAttachmentPersistence'
import type { ChatAttachment } from '../src/types/chat'

test('pasted images remain staged until submission and become durable image mentions on send', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const stored: string[] = []
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      tidecodeHistory: {
        storeChatImageAttachment: async ({ conversationId, fileName }: { conversationId: string; fileName: string }) => {
          assert.equal(conversationId, 'conversation-1')
          stored.push(fileName)
          return { fileName, path: `@attachments/${fileName}` }
        },
        cleanupUnreferencedChatAttachments: async () => undefined,
      },
    },
  })

  try {
    const image: ChatAttachment = {
      dataUrl: 'data:image/png;base64,YQ==',
      fileName: 'clipboard.png',
      id: 'image-1',
      kind: 'image',
      mimeType: 'image/png',
      sizeBytes: 1,
    }
    const draft = { attachments: [image], text: 'Look [Image #1]' }
    assert.deepEqual(stored, [])
    assert.equal('path' in image, false)

    const result = await persistStagedChatImages('conversation-1', [draft])
    assert.deepEqual(stored, ['clipboard.png'])
    assert.equal(draft.attachments[0], image)
    assert.deepEqual(result.storedPaths, ['@attachments/clipboard.png'])
    assert.equal(result.messages[0].text, 'Look [[tools.read:@attachments/clipboard.png]]')
    assert.equal(result.messages[0].mentionPathMap?.['clipboard.png'], '@attachments/clipboard.png')
    assert.equal(result.messages[0].attachments[0].kind, 'image')
    assert.equal('path' in result.messages[0].attachments[0], true)
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow)
    } else {
      Reflect.deleteProperty(globalThis, 'window')
    }
  }
})

test('a failed image submission cleans up only files saved during that attempt', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const removed: string[][] = []
  let count = 0
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      tidecodeHistory: {
        storeChatImageAttachment: async () => {
          count += 1
          if (count === 2) {
            throw new Error('Could not save second image')
          }
          return { fileName: 'first.png', path: '@attachments/first.png' }
        },
        cleanupUnreferencedChatAttachments: async (_conversationId: string, paths: string[]) => {
          removed.push(paths)
        },
      },
    },
  })
  const attachments: ChatAttachment[] = ['first', 'second'].map((id) => ({
    dataUrl: 'data:image/png;base64,YQ==',
    fileName: `${id}.png`,
    id,
    kind: 'image',
    mimeType: 'image/png',
    sizeBytes: 1,
  }))

  try {
    await assert.rejects(
      persistStagedChatImages('conversation-1', [{ attachments, text: '[Image #1] [Image #2]' }]),
      /Could not save second image/u,
    )
    assert.deepEqual(removed, [['@attachments/first.png']])
    assert.equal(attachments.every((attachment) => !('path' in attachment)), true)
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow)
    } else {
      Reflect.deleteProperty(globalThis, 'window')
    }
  }
})
