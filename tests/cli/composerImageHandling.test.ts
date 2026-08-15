import test from 'node:test'
import assert from 'node:assert/strict'
import type { ChatImageAttachment } from '../../src/types/chat'
import {
  applyComposerAction,
  attachImagesToComposer,
  composerText,
  createComposerState,
  removeAttachmentFromComposer,
} from '../../electron/cli/composer'

function createSampleImageAttachment(name: string, id: string): ChatImageAttachment {
  return {
    id,
    kind: 'image',
    fileName: name,
    mimeType: 'image/png',
    sizeBytes: 1024,
    dataUrl: 'data:image/png;base64,sample',
  }
}

test('attachImagesToComposer inserts [Image #1] reference and updates attachments', () => {
  let state = createComposerState()
  state = applyComposerAction(state, { type: 'insert', text: 'Here is a screenshot' })
  const image1 = createSampleImageAttachment('shot1.png', 'img-1')
  state = attachImagesToComposer(state, [image1])

  assert.equal(composerText(state), 'Here is a screenshot [Image #1] ')
  assert.equal(state.attachments.length, 1)
  assert.equal(state.attachments[0].id, 'img-1')

  const image2 = createSampleImageAttachment('shot2.png', 'img-2')
  state = attachImagesToComposer(state, [image2])
  assert.equal(composerText(state), 'Here is a screenshot [Image #1] [Image #2] ')
  assert.equal(state.attachments.length, 2)
  assert.equal(state.attachments[1].id, 'img-2')
})

test('composer atomically removes [Image #2] and renumbers subsequent references on Backspace', () => {
  let state = createComposerState()
  const image1 = createSampleImageAttachment('shot1.png', 'img-1')
  const image2 = createSampleImageAttachment('shot2.png', 'img-2')
  state = attachImagesToComposer(state, [image1, image2])
  assert.equal(composerText(state), '[Image #1] [Image #2] ')

  // First backspace deletes the trailing space
  state = applyComposerAction(state, { type: 'backspace' })
  assert.equal(composerText(state), '[Image #1] [Image #2]')

  // Second backspace atomically deletes [Image #2] and its attachment
  state = applyComposerAction(state, { type: 'backspace' })
  assert.equal(composerText(state), '[Image #1]')
  assert.equal(state.attachments.length, 1)
  assert.equal(state.attachments[0].id, 'img-1')
})

test('removeAttachmentFromComposer removes attachment and re-indexes text', () => {
  let state = createComposerState()
  const image1 = createSampleImageAttachment('shot1.png', 'img-1')
  const image2 = createSampleImageAttachment('shot2.png', 'img-2')
  state = attachImagesToComposer(state, [image1, image2])

  state = removeAttachmentFromComposer(state, 1)
  assert.equal(composerText(state), '[Image #1]')
  assert.equal(state.attachments.length, 1)
  assert.equal(state.attachments[0].id, 'img-2')
})

test('cursor leaps across [Image #1] reference token without landing inside brackets', () => {
  let state = createComposerState()
  const image1 = createSampleImageAttachment('shot1.png', 'img-1')
  state = attachImagesToComposer(state, [image1]) // '[Image #1] '
  state = applyComposerAction(state, { type: 'insert', text: 'hello' }) // '[Image #1] hello'

  // Cursor is at end (column 16)
  assert.equal(state.column, 16)

  // Move left 5 times across 'hello'
  for (let i = 0; i < 5; i++) {
    state = applyComposerAction(state, { type: 'move-left' })
  }
  assert.equal(state.column, 11) // at space after [Image #1]

  // Move left across [Image #1] -> leaps all the way to column 0 (left edge of [)
  state = applyComposerAction(state, { type: 'move-left' })
  assert.equal(state.column, 0)

  // Move right 1 time across [Image #1] -> leaps all the way to column 10 (right edge of ])
  state = applyComposerAction(state, { type: 'move-right' })
  assert.equal(state.column, 10)
})
