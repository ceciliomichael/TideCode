import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { mapConversationFiles } from '../../electron/history/conversationListing'
import type { ConversationRecord } from '../../src/types/chat'

test('history listing selects primary and orphan backups, skips metadata, and limits reads and transforms', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-listing-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  for (const name of ['a.json', 'a.json.bak', 'b.json.bak', 'c.json', 'd.json', 'folders.json', 'messages.jsonl', 'corrupt.json.corrupt']) {
    await fs.writeFile(path.join(directory, name), '{}')
  }
  const reads: string[] = []
  let active = 0
  let peak = 0
  const results = await mapConversationFiles(directory, async (record) => {
    await new Promise((resolve) => setImmediate(resolve))
    active -= 1
    return record.id === 'd.json' ? null : record.id
  }, async (filePath) => {
    active += 1
    peak = Math.max(peak, active)
    reads.push(path.basename(filePath))
    await new Promise((resolve) => setImmediate(resolve))
    return { id: path.basename(filePath) } as ConversationRecord
  })
  assert.equal(peak, 2)
  assert.deepEqual(reads.sort(), ['a.json', 'b.json.bak', 'c.json', 'd.json'])
  assert.deepEqual(results.sort(), ['a.json', 'b.json.bak', 'c.json'])
})

test('history transformation failures propagate instead of silently losing sidebar entries', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-listing-error-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  await fs.writeFile(path.join(directory, 'a.json'), '{}')
  await assert.rejects(mapConversationFiles(directory, () => {
    throw new Error('context hydration failed')
  }, async () => ({ id: 'a' }) as ConversationRecord), /context hydration failed/)
})
