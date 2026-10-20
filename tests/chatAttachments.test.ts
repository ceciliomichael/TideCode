import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import {
  adoptDraftChatAttachments,
  cleanupPreparedRemoteChatAttachmentUpload,
  finalizeRemoteChatAttachmentDirectory,
  listChatAttachments,
  prepareRemoteChatAttachmentUpload,
  readChatImageSource,
  resolveRemoteChatAttachmentFolderEntryPath,
  storeChatAttachment,
  storeChatImageAttachment,
} from '../electron/history/chatAttachments'
import { writeConversationFile } from '../electron/history/conversationFileStore'
import { replaceStoredMessages } from '../electron/history/store'
import { nameStagedChatImages } from '../src/lib/chatAttachmentNames'
import type { ConversationRecord, Message } from '../src/types/chat'
import {
  getConversationAttachmentsPath,
  getConversationFilePath,
  getDraftAttachmentsPath,
} from '../electron/history/paths'

function uniqueScope(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

test('folder attachments respect nested .gitignore rules and TideCode workspace ignores', async () => {
  const sourceRoot = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-attachment-source-'))
  const scopeId = uniqueScope('attachment-ignore-test')
  const attachmentRoot = getConversationAttachmentsPath(scopeId)

  try {
    await fs.mkdir(path.join(sourceRoot, 'node_modules', 'pkg'), { recursive: true })
    await fs.mkdir(path.join(sourceRoot, '.git'), { recursive: true })
    await fs.mkdir(path.join(sourceRoot, 'nested'), { recursive: true })
    await fs.mkdir(path.join(sourceRoot, 'ignored-dir'), { recursive: true })

    await fs.writeFile(
      path.join(sourceRoot, '.gitignore'),
      ['ignored.txt', 'ignored-dir/', 'nested/local-secret.txt'].join('\n'),
      'utf8',
    )
    await fs.writeFile(path.join(sourceRoot, 'keep.txt'), 'keep', 'utf8')
    await fs.writeFile(path.join(sourceRoot, 'ignored.txt'), 'ignore', 'utf8')
    await fs.writeFile(path.join(sourceRoot, 'ignored-dir', 'inside.txt'), 'ignore', 'utf8')
    await fs.writeFile(path.join(sourceRoot, 'nested', 'keep.md'), 'keep nested', 'utf8')
    await fs.writeFile(path.join(sourceRoot, 'nested', 'local-secret.txt'), 'ignore nested', 'utf8')
    await fs.writeFile(path.join(sourceRoot, 'node_modules', 'pkg', 'index.js'), 'ignored builtin', 'utf8')
    await fs.writeFile(path.join(sourceRoot, '.git', 'config'), 'ignored builtin', 'utf8')

    const stored = await storeChatAttachment({
      conversationId: scopeId,
      sourcePath: sourceRoot,
    })

    assert.equal(stored.kind, 'folder')
    const copiedRoot = path.join(attachmentRoot, stored.fileName)

    assert.equal(await fs.readFile(path.join(copiedRoot, 'keep.txt'), 'utf8'), 'keep')
    assert.equal(await fs.readFile(path.join(copiedRoot, 'nested', 'keep.md'), 'utf8'), 'keep nested')
    assert.equal(await fs.readFile(path.join(copiedRoot, '.gitignore'), 'utf8').then(() => true), true)

    await assert.rejects(fs.access(path.join(copiedRoot, 'ignored.txt')))
    await assert.rejects(fs.access(path.join(copiedRoot, 'ignored-dir')))
    await assert.rejects(fs.access(path.join(copiedRoot, 'nested', 'local-secret.txt')))
    await assert.rejects(fs.access(path.join(copiedRoot, 'node_modules')))
    await assert.rejects(fs.access(path.join(copiedRoot, '.git')))
  } finally {
    await fs.rm(sourceRoot, { force: true, recursive: true })
    await fs.rm(attachmentRoot, { force: true, recursive: true })
  }
})

test('separate attachment scopes keep identical filenames without cross-chat suffixes', async () => {
  const sourceRoot = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-attachment-scopes-'))
  const sourceFile = path.join(sourceRoot, 'hello.md')
  const firstScope = uniqueScope('attachment-scope-a')
  const secondScope = uniqueScope('attachment-scope-b')

  try {
    await fs.writeFile(sourceFile, '# hello\n', 'utf8')

    const first = await storeChatAttachment({
      conversationId: firstScope,
      sourcePath: sourceFile,
    })
    const second = await storeChatAttachment({
      conversationId: secondScope,
      sourcePath: sourceFile,
    })

    assert.equal(first.fileName, 'hello.md')
    assert.equal(second.fileName, 'hello.md')
    assert.equal(first.path, '@attachments/hello.md')
    assert.equal(second.path, '@attachments/hello.md')

    assert.deepEqual(
      (await listChatAttachments(firstScope)).map((attachment) => attachment.fileName),
      ['hello.md'],
    )
    assert.deepEqual(
      (await listChatAttachments(secondScope)).map((attachment) => attachment.fileName),
      ['hello.md'],
    )
  } finally {
    await fs.rm(sourceRoot, { force: true, recursive: true })
    await fs.rm(getConversationAttachmentsPath(firstScope), { force: true, recursive: true })
    await fs.rm(getConversationAttachmentsPath(secondScope), { force: true, recursive: true })
  }
})

test('draft attachment scopes adopt only their own files into the created conversation', async () => {
  const sourceRoot = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-attachment-adopt-'))
  const firstDraftScope = uniqueScope('VIRT_draft_a')
  const secondDraftScope = uniqueScope('VIRT_draft_b')
  const conversationId = uniqueScope('conversation')

  try {
    const firstFile = path.join(sourceRoot, 'first.txt')
    const secondFile = path.join(sourceRoot, 'second.txt')
    await fs.writeFile(firstFile, 'first', 'utf8')
    await fs.writeFile(secondFile, 'second', 'utf8')

    await storeChatAttachment({ conversationId: firstDraftScope, sourcePath: firstFile })
    await storeChatAttachment({ conversationId: secondDraftScope, sourcePath: secondFile })

    await adoptDraftChatAttachments(conversationId, firstDraftScope)

    assert.deepEqual(
      (await listChatAttachments(conversationId)).map((attachment) => attachment.fileName),
      ['first.txt'],
    )
    assert.deepEqual(
      (await listChatAttachments(secondDraftScope)).map((attachment) => attachment.fileName),
      ['second.txt'],
    )
    await assert.rejects(fs.access(getDraftAttachmentsPath(firstDraftScope)))
  } finally {
    await fs.rm(sourceRoot, { force: true, recursive: true })
    await fs.rm(getConversationAttachmentsPath(conversationId), { force: true, recursive: true })
    await fs.rm(getConversationAttachmentsPath(firstDraftScope), { force: true, recursive: true })
    await fs.rm(getConversationAttachmentsPath(secondDraftScope), { force: true, recursive: true })
  }
})

test('clipboard image files can be read into a draft without being copied to attachments', async () => {
  const sourceRoot = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-image-clipboard-'))
  const sourcePath = path.join(sourceRoot, 'clipboard.png')
  const encodedImage = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wb8tfYAAAAASUVORK5CYII='
  try {
    await fs.writeFile(sourcePath, Buffer.from(encodedImage, 'base64'))
    const staged = await readChatImageSource(sourcePath)
    assert.equal(staged?.fileName, 'clipboard.png')
    assert.equal(staged?.mimeType, 'image/png')
    assert.equal(staged?.dataUrl, `data:image/png;base64,${encodedImage}`)
    assert.equal(await readChatImageSource(path.join(sourceRoot, 'notes.txt')), null)
    assert.deepEqual(await fs.readdir(sourceRoot), ['clipboard.png'])
  } finally {
    await fs.rm(sourceRoot, { recursive: true, force: true })
  }
})

test('staged image name matches the eventual stored name when earlier attachments exist', async () => {
  const scopeId = uniqueScope('attachment-name-collision')
  const attachmentRoot = getConversationAttachmentsPath(scopeId)
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  try {
    const first = await storeChatImageAttachment({
      conversationId: scopeId,
      dataUrl: 'data:image/png;base64,YQ==',
      fileName: 'image.png',
    })
    assert.equal(first.fileName, 'image.png')
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { tidecodeHistory: { listChatAttachments } },
    })
    const image = {
      id: 'draft-image-1',
      dataUrl: 'data:image/png;base64,Yg==',
      fileName: 'image.png',
      kind: 'image' as const,
      mimeType: 'image/png',
      sizeBytes: 1,
    }
    const staged = await nameStagedChatImages(scopeId, [], [image])
    assert.equal(staged[0].fileName, 'image (2).png')
    assert.deepEqual((await fs.readdir(attachmentRoot)), ['image.png'])
    const stored = await storeChatImageAttachment({
      conversationId: scopeId,
      dataUrl: image.dataUrl,
      fileName: staged[0].fileName,
    })
    assert.equal(stored.fileName, staged[0].fileName)
    assert.equal(stored.path, '@attachments/image (2).png')
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, 'window', previousWindow)
    } else {
      Reflect.deleteProperty(globalThis, 'window')
    }
    await fs.rm(attachmentRoot, { force: true, recursive: true })
  }
})

test('remote attachment uploads reserve managed paths and reject folder traversal', async () => {
  const scopeId = uniqueScope('remote-attachment-upload')
  const prepared = await prepareRemoteChatAttachmentUpload({
    conversationId: scopeId,
    fileName: 'docs',
    isDirectory: true,
  })


  try {
    assert.equal(prepared.attachment.kind, 'folder')
    assert.equal(prepared.attachment.path, '@attachments/docs/')
    const nestedPath = await resolveRemoteChatAttachmentFolderEntryPath(
      prepared.absolutePath,
      'nested/spec.pdf',
    )
    assert.equal(path.dirname(nestedPath), path.join(prepared.absolutePath, 'nested'))
    await fs.writeFile(path.join(prepared.absolutePath, '.gitignore'), 'ignored.bin\n', 'utf8')
    await fs.writeFile(path.join(prepared.absolutePath, 'ignored.bin'), 'ignore me', 'utf8')
    await fs.writeFile(nestedPath, 'keep me', 'utf8')
    await finalizeRemoteChatAttachmentDirectory(prepared.absolutePath)
    await assert.rejects(fs.access(path.join(prepared.absolutePath, 'ignored.bin')))
    assert.equal(await fs.readFile(nestedPath, 'utf8'), 'keep me')
    await assert.rejects(
      () => resolveRemoteChatAttachmentFolderEntryPath(prepared.absolutePath, '../outside.txt'),
      /Invalid attachment folder path/u,
    )
    await assert.rejects(
      () => resolveRemoteChatAttachmentFolderEntryPath(prepared.absolutePath, 'nested/../../outside.txt'),
      /Invalid attachment folder path/u,
    )
  } finally {
    await cleanupPreparedRemoteChatAttachmentUpload(prepared.absolutePath)
    await fs.rm(getConversationAttachmentsPath(scopeId), { force: true, recursive: true })
  }
})

test('committed revert deletes discarded images but keeps images referenced by retained messages', async () => {
  const conversationId = uniqueScope('attachment-revert')
  const attachmentRoot = getConversationAttachmentsPath(conversationId)
  const shared = await storeChatImageAttachment({
    conversationId,
    dataUrl: 'data:image/png;base64,YQ==',
    fileName: 'shared.png',
  })
  const discarded = await storeChatImageAttachment({
    conversationId,
    dataUrl: 'data:image/png;base64,Yg==',
    fileName: 'discarded.png',
  })
  const retained: Message = {
    content: `Keep [[tools.read:${shared.path}]]`,
    id: 'user-1',
    mentionPathMap: { 'shared.png': shared.path },
    role: 'user',
    timestamp: 1,
  }
  const removed: Message = {
    attachments: [
      { ...shared, id: 'shared-image', kind: 'image', dataUrl: 'data:image/png;base64,YQ==' },
      { ...discarded, id: 'discarded-image', kind: 'image', dataUrl: 'data:image/png;base64,Yg==' },
    ],
    content: 'Two images',
    id: 'user-2',
    role: 'user',
    timestamp: 2,
  }
  const conversation: ConversationRecord = {
    agentContextRootPath: path.join(tmpdir(), 'tidecode-attachment-test-workspace'),
    chatMode: 'agent',
    createdAt: 1,
    folderId: null,
    id: conversationId,
    messages: [retained, removed],
    title: 'Image revert cleanup',
    updatedAt: 2,
  }

  try {
    await writeConversationFile(conversation)
    await replaceStoredMessages({
      conversationId,
      messages: [retained],
      synchronizeCanonicalHistory: false,
    })
    assert.equal(await fs.readFile(path.join(attachmentRoot, discarded.fileName), 'utf8'), 'b')

    await replaceStoredMessages({ conversationId, messages: [retained, removed] })
    await replaceStoredMessages({
      cleanupOrphanedAttachments: true,
      conversationId,
      messages: [retained],
    })
    await assert.rejects(fs.access(path.join(attachmentRoot, discarded.fileName)))
    assert.equal(await fs.readFile(path.join(attachmentRoot, shared.fileName), 'utf8'), 'a')
  } finally {
    await fs.rm(attachmentRoot, { force: true, recursive: true })
    await fs.rm(getConversationFilePath(conversationId), { force: true })
  }
})
