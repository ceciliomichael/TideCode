import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { readConversationRecordFromPath } from '../../electron/history/conversationFileReader'
import type { ConversationRecord } from '../../src/types/chat'

function buildConversationRecord(): ConversationRecord {
  return {
    agentContextRootPath: '/workspace',
    chatMode: 'agent',
    createdAt: 1,
    folderId: null,
    id: 'conversation-1',
    messages: [
      {
        content: 'Hello world',
        id: 'message-1',
        reasoningEffort: 'minimal',
        role: 'user',
        timestamp: 2,
      },
    ],
    title: 'Thread',
    updatedAt: 2,
  }
}

test('readConversationRecordFromPath falls back to the backup file when the primary file is truncated', async () => {
  const tempRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-conversation-file-store-'))
  const primaryFilePath = path.join(tempRootPath, 'conversation-1.json')
  const backupFilePath = `${primaryFilePath}.bak`
  const backupConversation = buildConversationRecord()

  try {
    await fs.writeFile(primaryFilePath, '', 'utf8')
    await fs.writeFile(backupFilePath, `${JSON.stringify(backupConversation, null, 2)}\n`, 'utf8')

    const result = await readConversationRecordFromPath(primaryFilePath)

    assert.equal(result.id, backupConversation.id)
    assert.equal(result.title, backupConversation.title)
    assert.equal(result.messages.length, 1)
    assert.equal(result.messages[0]?.content, 'Hello world')
  } finally {
    await fs.rm(tempRootPath, { force: true, recursive: true })
  }
})

test('readConversationRecordFromPath surfaces a parsing error when both the primary and backup files are invalid', async () => {
  const tempRootPath = await fs.mkdtemp(path.join(tmpdir(), 'tidecode-conversation-file-store-invalid-'))
  const primaryFilePath = path.join(tempRootPath, 'conversation-2.json')
  const backupFilePath = `${primaryFilePath}.bak`

  try {
    await fs.writeFile(primaryFilePath, '{', 'utf8')
    await fs.writeFile(backupFilePath, '', 'utf8')

    await assert.rejects(readConversationRecordFromPath(primaryFilePath), SyntaxError)
  } finally {
    await fs.rm(tempRootPath, { force: true, recursive: true })
  }
})
