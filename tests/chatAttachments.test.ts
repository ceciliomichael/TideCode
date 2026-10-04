import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import {
  adoptDraftChatAttachments,
  listChatAttachments,
  storeChatAttachment,
} from '../electron/history/chatAttachments'
import {
  getConversationAttachmentsPath,
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
