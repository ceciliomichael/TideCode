import assert from 'node:assert/strict'
import test from 'node:test'
import { loadToolImagePreview } from '../src/components/chat/toolImagePreview'

test('attachment image previews use the conversation attachment API', async () => {
  let workspaceReadCount = 0
  let attachmentRead: [string, string] | null = null
  const previousWindow = globalThis.window
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      tidecodeHistory: {
        readChatAttachmentImagePreview: async (conversationId: string, aliasPath: string) => {
          attachmentRead = [conversationId, aliasPath]
          return 'data:image/png;base64,preview'
        },
      },
      tidecodeWorkspace: {
        readFile: async () => {
          workspaceReadCount += 1
          return { status: 'missing' }
        },
      },
    },
  })

  try {
    const result = await loadToolImagePreview({
      conversationId: 'conversation-1',
      presentation: {
        fileName: 'image.png',
        kind: 'image',
        mediaType: 'image/png',
        relativePath: '@attachments/image.png',
      },
      workspaceRootPath: 'C:/workspace',
    })

    assert.equal(result, 'data:image/png;base64,preview')
    assert.deepEqual(attachmentRead, ['conversation-1', '@attachments/image.png'])
    assert.equal(workspaceReadCount, 0)
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: previousWindow,
    })
  }
})

test('workspace image previews keep using the workspace reader', async () => {
  let workspaceRead: { relativePath: string; workspaceRootPath: string } | null = null
  const previousWindow = globalThis.window
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      tidecodeHistory: {
        readChatAttachmentImagePreview: async () => null,
      },
      tidecodeWorkspace: {
        readFile: async (input: { relativePath: string; workspaceRootPath: string }) => {
          workspaceRead = input
          return {
            previewDataUrl: 'data:image/png;base64,workspace',
            status: 'ready',
          }
        },
      },
    },
  })

  try {
    const result = await loadToolImagePreview({
      conversationId: 'conversation-1',
      presentation: {
        fileName: 'image.png',
        kind: 'image',
        mediaType: 'image/png',
        relativePath: 'images/image.png',
      },
      workspaceRootPath: 'C:/workspace',
    })

    assert.equal(result, 'data:image/png;base64,workspace')
    assert.deepEqual(workspaceRead, {
      relativePath: 'images/image.png',
      workspaceRootPath: 'C:/workspace',
    })
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: previousWindow,
    })
  }
})

test('absolute image preview paths use the dedicated reader outside the workspace', async () => {
  const previousWindow = globalThis.window
  let receivedPath: string | null = null
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      tidecodeWorkspace: {
        readToolImagePreview: async (absolutePath: string) => {
          receivedPath = absolutePath
          return 'data:image/png;base64,absolute'
        },
        readFile: async () => {
          throw new Error('Workspace reader should not handle absolute tool images')
        },
      },
    },
  })

  try {
    const absolutePath = 'C:\\Users\\Admin\\AppData\\Local\\Temp\\bullet-zoom.png'
    const result = await loadToolImagePreview({
      conversationId: null,
      presentation: {
        fileName: 'bullet-zoom.png',
        kind: 'image',
        mediaType: 'image/png',
        relativePath: absolutePath,
      },
      workspaceRootPath: 'C:/workspace',
    })
    assert.equal(receivedPath, absolutePath)
    assert.equal(result, 'data:image/png;base64,absolute')
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: previousWindow,
    })
  }
})
