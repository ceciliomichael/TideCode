import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ChatMentionImageHoverContent,
} from '../src/components/chat/ChatMentionImageHoverContent'
import { findChatMentionImageAttachment } from '../src/lib/chatMentionImages'
import type { ChatImageAttachment } from '../src/types/chat'

const attachment: ChatImageAttachment = {
  dataUrl: 'data:image/png;base64,preview-data',
  fileName: 'preview.png',
  id: 'preview',
  kind: 'image',
  mimeType: 'image/png',
  path: '@attachments/preview.png',
  sizeBytes: 12,
}

test('image mention hover lookup resolves only the matching path-backed image', () => {
  assert.equal(
    findChatMentionImageAttachment('@attachments/preview.png', [attachment]),
    attachment,
  )
  assert.equal(findChatMentionImageAttachment('@attachments/other.png', [attachment]), null)
  assert.equal(
    findChatMentionImageAttachment('@attachments/preview.png', [{ ...attachment, path: undefined }]),
    null,
  )
})

test('image mention hover content renders only the preview image', () => {
  const markup = renderToStaticMarkup(
    <ChatMentionImageHoverContent
      attachment={attachment}
    />,
  )

  assert.match(markup, /<img/u)
  assert.match(markup, /src="data:image\/png;base64,preview-data"/u)
  assert.match(markup, /alt="preview.png"/u)
  assert.doesNotMatch(markup, /@attachments\/preview\.png/u)
})
