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
import {
  findChatMentionImageAttachment,
  getChatMentionImagePreview,
} from '../src/lib/chatMentionImages'
import { getChatMentionTooltipTarget } from '../src/lib/chatMentions'
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

test('image mention preview paths resolve attachments and workspace-relative aliases', () => {
  const attachmentPreview = getChatMentionImagePreview('tools.read:@attachments/preview.png', 'C:/work/project')
  assert.deepEqual(attachmentPreview, {
    presentation: {
      fileName: 'preview.png',
      kind: 'image',
      mediaType: 'image/png',
      relativePath: '@attachments/preview.png',
    },
    workspaceRootPath: 'C:/work/project',
  })

  const workspacePreview = getChatMentionImagePreview(
    '@workspace/project/images/photo.webp',
    'C:/work/project',
  )
  assert.deepEqual(workspacePreview, {
    presentation: {
      fileName: 'photo.webp',
      kind: 'image',
      mediaType: 'image/webp',
      relativePath: 'images/photo.webp',
    },
    workspaceRootPath: 'C:/work/project',
  })

  const absolutePreview = getChatMentionImagePreview(
    'tools.read:C:\\shared\\photo.avif',
    'C:/work/project',
  )
  assert.deepEqual(absolutePreview, {
    presentation: {
      fileName: 'photo.avif',
      kind: 'image',
      mediaType: 'image/avif',
      relativePath: 'C:\\shared\\photo.avif',
    },
    workspaceRootPath: 'C:/work/project',
  })

  const mismatchedWorkspacePreview = getChatMentionImagePreview(
    '@workspace/other/images/photo.webp',
    'C:/work/project',
  )
  assert.equal(mismatchedWorkspacePreview?.workspaceRootPath, null)
  assert.equal(
    mismatchedWorkspacePreview?.presentation.relativePath,
    '@workspace/other/images/photo.webp',
  )
})

test('image preview readers load attachment, workspace, and absolute paths', async () => {
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const readerCalls: Array<readonly [string, ...string[]]> = []
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      tidecodeHistory: {
        readChatAttachmentImagePreview: async (conversationId: string, relativePath: string) => {
          readerCalls.push(['attachment', conversationId, relativePath])
          return 'data:image/png;base64,attachment'
        },
      },
      tidecodeWorkspace: {
        readFile: async ({ relativePath, workspaceRootPath }: {
          relativePath: string
          workspaceRootPath: string
        }) => {
          readerCalls.push(['workspace', workspaceRootPath, relativePath])
          return {
            previewDataUrl: 'data:image/webp;base64,workspace',
            status: 'ready',
          }
        },
        readToolImagePreview: async (absolutePath: string) => {
          readerCalls.push(['absolute', absolutePath])
          return 'data:image/avif;base64,absolute'
        },
      },
    },
  })

  try {
    const attachmentPreview = getChatMentionImagePreview('@attachments/preview.png')
    const workspacePreview = getChatMentionImagePreview(
      '@workspace/project/images/photo.webp',
      'C:/work/project',
    )
    const absolutePreview = getChatMentionImagePreview('C:\\shared\\photo.avif')
    const mismatchedWorkspacePreview = getChatMentionImagePreview(
      '@workspace/other/images/photo.webp',
      'C:/work/project',
    )

    assert.ok(attachmentPreview)
    assert.ok(workspacePreview)
    assert.ok(absolutePreview)
    assert.ok(mismatchedWorkspacePreview)
    assert.equal(
      await loadToolImagePreview({
        conversationId: 'conversation-1',
        presentation: attachmentPreview.presentation,
        workspaceRootPath: attachmentPreview.workspaceRootPath,
      }),
      'data:image/png;base64,attachment',
    )
    assert.equal(
      await loadToolImagePreview({
        presentation: workspacePreview.presentation,
        workspaceRootPath: workspacePreview.workspaceRootPath,
      }),
      'data:image/webp;base64,workspace',
    )
    assert.equal(
      await loadToolImagePreview({
        presentation: absolutePreview.presentation,
        workspaceRootPath: absolutePreview.workspaceRootPath,
      }),
      'data:image/avif;base64,absolute',
    )
    assert.equal(
      await loadToolImagePreview({
        presentation: mismatchedWorkspacePreview.presentation,
        workspaceRootPath: mismatchedWorkspacePreview.workspaceRootPath,
      }),
      null,
    )
    assert.deepEqual(readerCalls, [
      ['attachment', 'conversation-1', '@attachments/preview.png'],
      ['workspace', 'C:/work/project', 'images/photo.webp'],
      ['absolute', 'C:\\shared\\photo.avif'],
    ])
  } finally {
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, 'window', originalWindowDescriptor)
    } else {
      Reflect.deleteProperty(globalThis, 'window')
    }
  }
})

test('non-image mentions keep path tooltips and unavailable image readers return null', async () => {
  assert.equal(getChatMentionImagePreview('tools.read:src/readme.md', 'C:/work/project'), null)
  assert.equal(getChatMentionTooltipTarget('tools.read:src/readme.md'), 'src/readme.md')
  assert.equal(getChatMentionImagePreview('tools.skill.load:image.png', 'C:/work/project'), null)

  const attachmentPreview = getChatMentionImagePreview('@attachments/missing.png')
  assert.ok(attachmentPreview)
  assert.equal(
    await loadToolImagePreview({
      conversationId: null,
      presentation: attachmentPreview.presentation,
      workspaceRootPath: attachmentPreview.workspaceRootPath,
    }),
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
