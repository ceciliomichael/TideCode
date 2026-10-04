import assert from 'node:assert/strict'
import test from 'node:test'
import { copyTextToClipboard } from '../src/lib/clipboard'
import { parseDropFilesBuffer } from '../electron/clipboard/windowsDropFilesParser'
import {
  buildDropFilesBuffer,
  buildPreferredDropEffectBuffer,
} from '../electron/clipboard/windowsDropFilesWriter'

function createLegacyDocument(copyResult: boolean) {
  const calls: string[] = []
  const textArea = {
    value: '',
    style: { position: '', opacity: '', pointerEvents: '' },
    setAttribute(name: string, value: string) {
      calls.push(`attribute:${name}=${value}`)
    },
    focus() {
      calls.push('focus')
    },
    select() {
      calls.push('select')
    },
    remove() {
      calls.push('remove')
    },
  }
  const document = {
    body: {
      appendChild() {
        calls.push('append')
      },
    },
    createElement(tagName: 'textarea') {
      calls.push(`create:${tagName}`)
      return textArea
    },
    execCommand(commandId: string) {
      calls.push(`exec:${commandId}`)
      return copyResult
    },
  }

  return { calls, document, textArea }
}

test('copyTextToClipboard uses the modern Clipboard API when available', async () => {
  const writes: string[] = []
  const copied = await copyTextToClipboard('assistant reply', {
    clipboard: {
      async writeText(text) {
        writes.push(text)
      },
    },
    document: null,
  })

  assert.equal(copied, true)
  assert.deepEqual(writes, ['assistant reply'])
})

test('copyTextToClipboard falls back when Clipboard API rejects on web', async () => {
  const legacy = createLegacyDocument(true)
  const copied = await copyTextToClipboard('web reply', {
    clipboard: {
      async writeText() {
        throw new Error('NotAllowedError')
      },
    },
    document: legacy.document,
  })

  assert.equal(copied, true)
  assert.equal(legacy.textArea.value, 'web reply')
  assert.deepEqual(legacy.calls, [
    'create:textarea',
    'attribute:readonly=',
    'append',
    'focus',
    'select',
    'exec:copy',
    'remove',
  ])
})

test('copyTextToClipboard reports failure when no copy path succeeds', async () => {
  const legacy = createLegacyDocument(false)
  const copied = await copyTextToClipboard('web reply', {
    clipboard: null,
    document: legacy.document,
  })

  assert.equal(copied, false)
  assert.equal(legacy.calls.at(-1), 'remove')
})

test('Windows file clipboard writer creates a valid CF_HDROP buffer', () => {
  const paths = [
    'C:\\Users\\Admin\\Desktop\\tidecode\\README.md',
    'C:\\Users\\Admin\\Desktop\\tidecode\\src',
  ]

  assert.deepEqual(parseDropFilesBuffer(buildDropFilesBuffer(paths)), paths)
})

test('Windows file clipboard writer sets copy and move drop effects', () => {
  assert.equal(buildPreferredDropEffectBuffer('copy').readUInt32LE(0), 1)
  assert.equal(buildPreferredDropEffectBuffer('cut').readUInt32LE(0), 2)
})
