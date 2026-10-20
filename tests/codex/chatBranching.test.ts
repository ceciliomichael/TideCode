import assert from 'node:assert/strict'
import test from 'node:test'
import { getConversationBranchMessages, getConversationBranchTitle } from '../../src/lib/chatBranching'
import type { Message } from '../../src/types/chat'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { electronApp } from '../../electron/electronApp'
import { createStoredConversation, replaceStoredMessages } from '../../electron/history/store'
import { getConversationAttachmentsPath, getHistoryDirectoryPath } from '../../electron/history/paths'
import { createEmptyCanonicalHistory } from '../../electron/chat/history/contracts'
import { encodeModelMessages, encodeReplayValue } from '../../electron/chat/history/replayCodec'
import {
  listCompactionMarkers, readCanonicalHistory, readLatestCompactionPacket, readLatestConversationMemory,
  recordCompactionCommitted,
} from '../../electron/chat/history/eventStore'
import { projectCanonicalReplay } from '../../electron/chat/history/replayProjector'
import { buildModelMessages } from '../../electron/chat/shared/messages'
import { createCompactionPacketFixture } from './compactionFixtures'
import { sha256, stableStringify } from '../../electron/chat/cache/canonicalization'

const messages: Message[] = [
  { id: 'user-1', role: 'user', content: 'First request', timestamp: 1 },
  { id: 'assistant-1', role: 'assistant', content: 'First response', timestamp: 2 },
  { id: 'user-2', role: 'user', content: 'Second request', timestamp: 3 },
  { id: 'assistant-2', role: 'assistant', content: 'Second response', timestamp: 4 },
]

test('conversation branching keeps transcript through the selected assistant message', () => {
  assert.deepEqual(
    getConversationBranchMessages(messages, 'assistant-1').map((message) => message.id),
    ['user-1', 'assistant-1'],
  )
})

test('conversation branching rejects user or missing message ids', () => {
  assert.throws(() => getConversationBranchMessages(messages, 'user-2'), /assistant message selected for branching/)
  assert.throws(() => getConversationBranchMessages(messages, 'missing'), /assistant message selected for branching/)
})

test('branched conversations use a Branch title prefix', () => {
  assert.equal(getConversationBranchTitle('Fix remote chat'), 'Branch · Fix remote chat')
  assert.equal(getConversationBranchTitle('  Fix remote chat  '), 'Branch · Fix remote chat')
  assert.equal(getConversationBranchTitle(''), 'Branch')
})

test('stored branches and repeated reverts preserve matching compaction, memory and attachments independently', async () => {
  const testHome = await fs.mkdtemp(path.join(os.tmpdir(), 'tidecode-branch-history-'))
  const originalGetPath = electronApp.getPath
  electronApp.getPath = () => testHome
  try {
    const source = await createStoredConversation()
    const transcript: Message[] = [
      { id: 'u1', role: 'user', content: 'old request', timestamp: 10 },
      { id: 'a1', role: 'assistant', content: 'old answer', reasoningContent: '', timestamp: 30 },
      { id: 'u2', role: 'user', content: 'second request', timestamp: 40 },
      { id: 'a2', role: 'assistant', content: 'retained answer', reasoningContent: '', timestamp: 60 },
      { id: 'u3', role: 'user', content: 'future request', timestamp: 70 },
      { id: 'a3', role: 'assistant', content: 'future answer', reasoningContent: '', timestamp: 90 },
    ]
    await replaceStoredMessages({ conversationId: source.id, messages: transcript })
    const canonical = createEmptyCanonicalHistory(source.id, 1)
    for (let index = 1; index <= 3; index += 1) {
      const packet = createCompactionPacketFixture({ sourceDigest: `digest-${index}`, sourceMessageIds: ['model:0'] })
      canonical.events.push({
        type: 'compaction_committed', branchId: 'main', eventId: `e${index}`, runId: null,
        revision: index, createdAt: 20 + (index - 1) * 30, anchorUserMessageId: `u${index}`,
        compactionId: `c${index}`, modelId: 'model', providerId: 'openai', sourceDigest: packet.sourceDigest,
        sourceMessageIds: packet.sourceMessageIds, usedFallback: false, packet: encodeReplayValue(packet),
        projectedMessages: encodeModelMessages([{ role: 'assistant', content: packet.continuationMarkdown }]),
        durableMemory: encodeReplayValue({ schema: 'tidecode.conversation_memory/v1', markdown: `Memory ${index}`, sourceDigest: packet.sourceDigest }),
      })
    }
    canonical.revision = 3
    // Simulate assistant output saved after the last canonical message synchronization.
    canonical.synchronizedMessageIds = transcript.slice(0, 3).map((message) => message.id)
    canonical.synchronizedMessageDigests = transcript.slice(0, 3).map((message) => sha256(stableStringify(message)))
    const canonicalPath = path.join(getHistoryDirectoryPath(), 'canonical-history', `${source.id}.json`)
    await fs.mkdir(path.dirname(canonicalPath), { recursive: true })
    await fs.writeFile(canonicalPath, JSON.stringify(canonical))
    const sourceBytes = await fs.readFile(canonicalPath, 'utf8')
    const attachmentRoot = getConversationAttachmentsPath(source.id)
    await fs.mkdir(attachmentRoot, { recursive: true })
    await fs.writeFile(path.join(attachmentRoot, 'evidence.txt'), 'retained attachment')

    const branch = await createStoredConversation({ branchSourceConversationId: source.id, branchThroughMessageId: 'a2' })
    assert.deepEqual(branch.messages, transcript.slice(0, 4))
    assert.equal(await fs.readFile(path.join(getConversationAttachmentsPath(branch.id), 'evidence.txt'), 'utf8'), 'retained attachment')
    assert.equal((await readLatestCompactionPacket(branch.id))?.sourceDigest, 'digest-2')
    assert.equal((await readLatestConversationMemory(branch.id))?.markdown, 'Memory 2')
    assert.deepEqual((await listCompactionMarkers(branch.id)).map((marker) => marker.compactionId), ['c1', 'c2'])
    assert.equal(await fs.readFile(canonicalPath, 'utf8'), sourceBytes)
    const branchDocument = await readCanonicalHistory(branch.id)
    assert.doesNotMatch(JSON.stringify(branchDocument), /digest-3|Memory 3|future answer/)
    const projected = projectCanonicalReplay({
      document: branchDocument, messages: branch.messages, fallbackMessages: buildModelMessages(branch.messages),
      modelId: 'switched-model', providerId: 'codex',
    })
    assert.equal(projected.isCompacted, true)
    assert.match(JSON.stringify(projected.messages), /retained answer/)
    assert.doesNotMatch(JSON.stringify(projected.messages), /old answer|future answer/)

    const branchPacket = createCompactionPacketFixture({ sourceDigest: 'branch-only', sourceMessageIds: ['model:0'] })
    await recordCompactionCommitted({
      conversationId: branch.id, compactionId: 'branch-only', anchorUserMessageId: 'u2', modelId: 'model', providerId: 'openai',
      packet: branchPacket, projectedMessages: [{ role: 'assistant', content: branchPacket.continuationMarkdown }],
      sourceDigest: branchPacket.sourceDigest, sourceMessageIds: branchPacket.sourceMessageIds,
      durableMemory: { schema: 'tidecode.conversation_memory/v1', markdown: 'Independent memory', sourceDigest: 'branch-only' },
    })
    assert.equal((await readLatestConversationMemory(branch.id))?.markdown, 'Independent memory')
    assert.equal((await readLatestConversationMemory(source.id))?.markdown, 'Memory 3')

    await replaceStoredMessages({ conversationId: source.id, messages: transcript.slice(0, 4), synchronizeCanonicalHistory: true })
    assert.equal((await readLatestCompactionPacket(source.id))?.sourceDigest, 'digest-2')
    assert.equal((await readLatestConversationMemory(source.id))?.markdown, 'Memory 2')
    assert.deepEqual((await listCompactionMarkers(source.id)).map((marker) => marker.compactionId), ['c1', 'c2'])
    await replaceStoredMessages({ conversationId: source.id, messages: transcript.slice(0, 2), synchronizeCanonicalHistory: true })
    assert.equal((await readLatestCompactionPacket(source.id))?.sourceDigest, 'digest-1')
    assert.equal((await readLatestConversationMemory(source.id))?.markdown, 'Memory 1')
    const nestedBranch = await createStoredConversation({ branchSourceConversationId: source.id, branchThroughMessageId: 'a1' })
    assert.deepEqual((await listCompactionMarkers(nestedBranch.id)).map((marker) => marker.compactionId), ['c1'])
  } finally {
    electronApp.getPath = originalGetPath
    assert.equal(path.dirname(testHome), os.tmpdir())
    await fs.rm(testHome, { recursive: true, force: true })
  }
})
