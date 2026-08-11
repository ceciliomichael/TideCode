import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChatMentionText } from '../src/components/chat/ChatMentionText'
import type { ChatImageAttachment } from '../src/types/chat'

test('rendered image references remain inline and keyboard-focusable for preview', () => {
  const attachment: ChatImageAttachment = {
    dataUrl: 'data:image/png;base64,preview-data',
    fileName: 'preview.png',
    id: 'preview',
    kind: 'image',
    mimeType: 'image/png',
    sizeBytes: 12,
  }
  const markup = renderToStaticMarkup(
    <ChatMentionText
      imageAttachments={[attachment]}
      text="Review [Image #1] here"
      variant="rendered"
    />,
  )

  assert.match(markup, /Review /u)
  assert.match(markup, /\[Image #1\]/u)
  assert.match(markup, /tabindex="0"/u)
})
