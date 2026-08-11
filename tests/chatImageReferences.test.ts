import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ensureChatImageReferences,
  findChatImageReferenceForDeletion,
  insertChatImageReferences,
  removeChatImageReference,
} from '../src/lib/chatImageReferences'
import type { ChatAttachment } from '../src/types/chat'

function image(id: string): ChatAttachment {
  return {
    dataUrl: `data:image/png;base64,${id}`,
    fileName: `${id}.png`,
    id,
    kind: 'image',
    mimeType: 'image/png',
    sizeBytes: 10,
  }
}

test('image references are inserted at the cursor next to the describing text', () => {
  assert.deepEqual(insertChatImageReferences({
    count: 2,
    firstImageNumber: 1,
    position: 12,
    text: 'Compare this with that',
  }), {
    cursorPosition: 34,
    text: 'Compare this [Image #1] [Image #2] with that',
  })
})

test('missing image references are appended once for legacy attachment messages', () => {
  const attachments = [image('first'), image('second')]
  const referenced = ensureChatImageReferences('Review [Image #1]', attachments)
  assert.equal(referenced, 'Review [Image #1] [Image #2]')
  assert.equal(ensureChatImageReferences(referenced, attachments), referenced)
})

test('removing an inline image reference removes its attachment and renumbers later images', () => {
  const result = removeChatImageReference({
    attachments: [image('first'), image('second')],
    imageNumber: 1,
    text: 'First [Image #1], then [Image #2].',
  })

  assert.deepEqual(result.attachments.map((attachment) => attachment.id), ['second'])
  assert.equal(result.text, 'First, then [Image #1].')
})

test('Backspace and Delete treat an image reference as one atomic unit', () => {
  const text = 'Review [Image #1] now'
  const referenceEnd = text.indexOf(']') + 1
  assert.equal(findChatImageReferenceForDeletion({
    imageCount: 1,
    key: 'Backspace',
    selectionEnd: referenceEnd,
    selectionStart: referenceEnd,
    text,
  })?.imageNumber, 1)
  assert.equal(findChatImageReferenceForDeletion({
    imageCount: 1,
    key: 'Delete',
    selectionEnd: 7,
    selectionStart: 7,
    text,
  })?.imageNumber, 1)
})
