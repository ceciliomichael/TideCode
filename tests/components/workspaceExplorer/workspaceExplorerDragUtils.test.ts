import assert from 'node:assert/strict'
import test from 'node:test'
import { getExternalClipboardFilePaths } from '../../../src/components/workspaceExplorer/workspaceExplorerPanel/workspaceExplorerDragUtils'

test('clipboard file extraction ignores empty paths and preserves valid file paths', () => {
  const event = {
    clipboardData: {
      files: [
        { path: '/Users/administrator/Desktop/notes.txt' },
        { path: '   ' },
        { path: '/projects/image.png' },
      ],
    },
  } as Parameters<typeof getExternalClipboardFilePaths>[0]

  assert.deepEqual(getExternalClipboardFilePaths(event), [
    '/Users/administrator/Desktop/notes.txt',
    '/projects/image.png',
  ])
})

test('clipboard file extraction falls back to Electron webUtils paths', () => {
  const previousWindow = globalThis.window
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      echosphereFileDrop: {
        getPathForFile: (file: { nativePath?: string }) => file.nativePath ?? '',
      },
    },
  })

  try {
    const event = {
      clipboardData: {
        files: [
          { nativePath: ' C:\\Users\\Administrator\\Desktop\\notes.txt ' },
          { nativePath: '' },
        ],
      },
    } as unknown as Parameters<typeof getExternalClipboardFilePaths>[0]

    assert.deepEqual(getExternalClipboardFilePaths(event), [
      'C:\\Users\\Administrator\\Desktop\\notes.txt',
    ])
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: previousWindow,
    })
  }
})
