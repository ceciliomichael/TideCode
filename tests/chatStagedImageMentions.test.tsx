import assert from 'node:assert/strict'
import test from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import { ChatMentionText } from '../src/components/chat/ChatMentionText'
import { ChatMentionImageHoverContent } from '../src/components/chat/ChatMentionImageHoverContent'
import { getAttachmentMentionEntries } from '../src/components/chat/chatMentionCatalog'
import { findChatMentionImageAttachment } from '../src/lib/chatMentionImages'
import { expandChatMentions, findChatMentionMatches, insertChatMentionAtPosition } from '../src/lib/chatMentions'
import { getChatAttachmentMentionPath, getStagedChatImagePath, hasStagedChatImageMention } from '../src/lib/chatStagedImageMentions'
import type { ChatImageAttachment } from '../src/types/chat'

const image: ChatImageAttachment = {
  dataUrl: 'data:image/png;base64,YQ==',
  fileName: 'clipboard.png',
  id: 'draft-image-1',
  kind: 'image',
  mimeType: 'image/png',
  sizeBytes: 1,
}

test('pasting an unsaved image inserts a real attachment mention with no file path or early write', () => {
  const stagedPath = getStagedChatImagePath(image)
  assert.equal(image.path, undefined)
  assert.equal(getChatAttachmentMentionPath(image), stagedPath)
  const insertion = insertChatMentionAtPosition('Look here', 4, image.fileName)
  assert.equal(insertion.nextValue, 'Look @clipboard.png here')
  const mentionMap = new Map([[image.fileName, stagedPath]])
  const matches = findChatMentionMatches(insertion.nextValue, mentionMap)
  assert.deepEqual(matches.map((match) => match.path), [stagedPath])
  assert.equal(hasStagedChatImageMention([image], mentionMap), true)
  assert.equal(findChatMentionImageAttachment(stagedPath, [image]), image)
  assert.equal(
    expandChatMentions(insertion.nextValue, mentionMap),
    `Look [[tools.read:${stagedPath}]] here`,
  )
  assert.equal(getAttachmentMentionEntries([image])[0]?.relativePath, stagedPath)
})

test('unsent image mention is highlighted and has a hover image preview', () => {
  const stagedPath = getStagedChatImagePath(image)
  const markup = renderToStaticMarkup(
    <ChatMentionText
      imageAttachments={[image]}
      mentionPathMap={new Map([[image.fileName, stagedPath]])}
      text="Look @clipboard.png"
      variant="rendered"
    />,
  )
  assert.match(markup, /@clipboard\.png/u)
  assert.match(markup, /bg-info-surface/u)
  const hoverImage = findChatMentionImageAttachment(stagedPath, [image])
  assert.equal(hoverImage, image)
  const hoverMarkup = renderToStaticMarkup(<ChatMentionImageHoverContent attachment={hoverImage!} />)
  assert.match(hoverMarkup, /data:image\/png;base64,YQ==/u)
  assert.doesNotMatch(markup, /\[Image #1\]/u)
})

test('removing a staged mention leaves no matching reference for its image', () => {
  const stagedPath = getStagedChatImagePath(image)
  const mentionMap = new Map([[image.fileName, stagedPath]])
  const text = 'Hello @clipboard.png'
  assert.equal(findChatMentionMatches(text, mentionMap).length, 1)
  const remaining = text.replace('@clipboard.png', '')
  const activePaths = new Set(findChatMentionMatches(remaining, mentionMap).map((match) => match.path))
  assert.equal(activePaths.has(getChatAttachmentMentionPath(image)), false)
})
