import assert from 'node:assert/strict'
import test from 'node:test'
import { nameStagedChatImages, resolveUniqueChatAttachmentFileName } from '../src/lib/chatAttachmentNames'
import type { ChatAttachment } from '../src/types/chat'

function draftImage(id: string, fileName = 'image.png'): ChatAttachment {
  return {
    dataUrl: `data:image/png;base64,${id}`,
    fileName,
    id,
    kind: 'image',
    mimeType: 'image/png',
    sizeBytes: 1,
  }
}

test('draft image mentions use actual collision-free filenames without saving a file', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const readScopes: string[] = []
  let writes = 0
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      tidecodeHistory: {
        listChatAttachments: async (conversationId: string) => {
          readScopes.push(conversationId)
          return [
            { fileName: 'image.png', path: '@attachments/image.png' },
            { fileName: 'image (2).png', path: '@attachments/image (2).png' },
          ]
        },
        storeChatImageAttachment: async () => { writes += 1 },
      },
    },
  })
  try {
    const oldStaged = draftImage('old', 'image (3).png')
    const incoming = [draftImage('next'), draftImage('next-again'), draftImage('unrelated', 'second.png')]
    const named = await nameStagedChatImages('existing-chat', [oldStaged], incoming)
    assert.deepEqual(named.map((attachment) => attachment.fileName), [
      'image (4).png',
      'image (5).png',
      'second.png',
    ])
    assert.deepEqual(incoming.map((attachment) => attachment.fileName), [
      'image.png',
      'image.png',
      'second.png',
    ])
    assert.deepEqual(readScopes, ['existing-chat'])
    assert.equal(writes, 0)
    assert.equal(named.every((attachment) => !('path' in attachment)), true)
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow)
    } else {
      Reflect.deleteProperty(globalThis, 'window')
    }
  }
})

test('new conversation and case-insensitive names resolve without writing', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const scopes: string[] = []
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      tidecodeHistory: {
        listChatAttachments: async (id: string) => {
          scopes.push(id)
          return [{ fileName: 'IMAGE.PNG' }]
        },
      },
    },
  })
  try {
    const named = await nameStagedChatImages(null, [], [draftImage('a')])
    assert.equal(named[0].fileName, 'image (2).png')
    assert.deepEqual(scopes, [''])
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow)
    } else {
      Reflect.deleteProperty(globalThis, 'window')
    }
  }
})

test('suffix algorithm matches saved attachment naming and sanitizes invalid names', async () => {
  const occupied = new Set(['image.png', 'image (2).png'])
  assert.equal(await resolveUniqueChatAttachmentFileName('image.png', false, (name) => occupied.has(name)), 'image (3).png')
  assert.equal(await resolveUniqueChatAttachmentFileName('image.png', false, () => false), 'image.png')
  assert.equal(await resolveUniqueChatAttachmentFileName('bad?.png', false, () => false), 'bad_.png')
})
