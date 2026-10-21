import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ChatMentionImageHoverContent,
} from '../src/components/chat/ChatMentionImageHoverContent'
import { ChatMentionText } from '../src/components/chat/ChatMentionText'
import { ChatMentionTextarea } from '../src/components/chat/ChatMentionTextarea'
import { findChatMentionImageAttachment, getChatMentionImagePreview } from '../src/lib/chatMentionImages'
import { loadToolImagePreview } from '../src/components/chat/toolImagePreview'
import type { ChatImageAttachment } from '../src/types/chat'
import { ChatMentionMenu } from '../src/components/chat/ChatMentionMenu'
import { getChatMentionCategories } from '../src/components/chat/chatMentionCatalog'

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
    findChatMentionImageAttachment('tools.read:@attachments/preview.png', [attachment]),
    attachment,
  )
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

test('image mention preview lookup recognizes attachment, workspace, and absolute image paths', () => {
  assert.deepEqual(
    getChatMentionImagePreview('tools.read:@attachments/preview.png', 'C:/work/project'),
    {
      presentation: {
        fileName: 'preview.png',
        kind: 'image',
        mediaType: 'image/png',
        relativePath: '@attachments/preview.png',
      },
      workspaceRootPath: 'C:/work/project',
    },
  )
  assert.deepEqual(
    getChatMentionImagePreview('@workspace/project/images/photo.webp', 'C:/work/project'),
    {
      presentation: {
        fileName: 'photo.webp',
        kind: 'image',
        mediaType: 'image/webp',
        relativePath: 'images/photo.webp',
      },
      workspaceRootPath: 'C:/work/project',
    },
  )
  assert.deepEqual(
    getChatMentionImagePreview('tools.read:C:\\shared\\photo.avif', 'C:/work/project')?.presentation,
    {
      fileName: 'photo.avif',
      kind: 'image',
      mediaType: 'image/avif',
      relativePath: 'C:\\shared\\photo.avif',
    },
  )
})

test('non-image paths and skill or MCP targets keep their ordinary tooltip text', () => {
  assert.equal(getChatMentionImagePreview('tools.read:src/readme.md', 'C:/work/project'), null)
  assert.equal(getChatMentionImagePreview('tools.skill.load:image.png', 'C:/work/project'), null)
  assert.equal(getChatMentionImagePreview('tools.available.search:images.png', 'C:/work/project'), null)
})

test('path-backed attachment image previews load through the active conversation', async () => {
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const readerCalls: string[][] = []

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      tidecodeHistory: {
        readChatAttachmentImagePreview: async (conversationId: string, aliasPath: string) => {
          readerCalls.push([conversationId, aliasPath])
          return 'data:image/png;base64,attachment-preview'
        },
      },
    },
  })

  try {
    const imagePreview = getChatMentionImagePreview('@attachments/preview.png')
    assert.ok(imagePreview)
    assert.equal(
      await loadToolImagePreview({
        conversationId: 'conversation-1',
        presentation: imagePreview.presentation,
        workspaceRootPath: imagePreview.workspaceRootPath,
      }),
      'data:image/png;base64,attachment-preview',
    )
    assert.deepEqual(readerCalls, [['conversation-1', '@attachments/preview.png']])
  } finally {
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, 'window', originalWindowDescriptor)
    } else {
      Reflect.deleteProperty(globalThis, 'window')
    }
  }
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

test('rendered mention text stays above its highlight surface', () => {
  const markup = renderToStaticMarkup(
    <ChatMentionText
      mentionPathMap={new Map([['preview.png', '@attachments/preview.png']])}
      text="@preview.png"
      variant="rendered"
    />,
  )

  assert.match(markup, /@preview\.png/u)
  assert.match(markup, /z-\[2\]/u)
  assert.match(markup, /z-\[1\]/u)
})

test('composer textarea text stays above the mention highlight backdrop', () => {
  const markup = renderToStaticMarkup(
    <ChatMentionTextarea
      mentionPathMap={new Map([['preview.png', '@attachments/preview.png']])}
      onChange={() => undefined}
      onKeyDown={() => undefined}
      textareaRef={createRef<HTMLTextAreaElement>()}
      value="look at @preview.png"
    />,
  )

  assert.match(markup, /<textarea[^>]*z-\[2\]/u)
  assert.match(markup, /pointer-events-none absolute inset-0 z-\[1\]/u)
})

test('catalog hides empty attachments and renders MCP with its violet accent', () => {
  const renderMenu = (hasAttachments: boolean, hasConnectedMcp: boolean) => renderToStaticMarkup(
    <ChatMentionMenu
      anchorRef={null!}
      categories={getChatMentionCategories(hasAttachments, hasConnectedMcp)}
      isOpen
      loading={false}
      menuRef={createRef<HTMLDivElement>()}
      menuStyle={{}}
      onSelect={() => undefined}
      onSelectCategory={() => undefined}
      onHighlightIndex={() => undefined}
      onResetHighlight={() => undefined}
      results={[]}
      highlightedIndex={0}
      selectedMenuType={null}
      searchQuery=""
      workspaceRootAvailable
    />,
  )
  const emptyMarkup = renderMenu(false, true)
  assert.doesNotMatch(emptyMarkup, />Attachments</u)
  assert.match(emptyMarkup, />MCP</u)
  assert.match(emptyMarkup, /text-mcp-foreground/u)
  assert.match(renderMenu(true, true), />Attachments</u)
  assert.doesNotMatch(renderMenu(false, false), />MCP</u)
})

test('MCP mentions use the violet highlight surface', () => {
  const markup = renderToStaticMarkup(
    <ChatMentionText text="[[tools.available.search:GitHub]]" variant="rendered" />,
  )
  assert.match(markup, /@GitHub/u)
  assert.match(markup, /bg-mcp-surface/u)
})
