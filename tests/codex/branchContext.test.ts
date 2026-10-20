import assert from 'node:assert/strict'
import test from 'node:test'
import { createEmptyCanonicalHistory, type CanonicalHistoryEvent } from '../../electron/chat/history/contracts'
import { getBranchHistoryEvents, getHistoryCutoffRevision } from '../../electron/chat/history/branchContext'
import { carryCompletedReplaysAcrossBranch } from '../../electron/chat/history/branchReplay'
import { projectCanonicalReplay } from '../../electron/chat/history/replayProjector'
import { encodeModelMessages, encodeReplayValue } from '../../electron/chat/history/replayCodec'
import { buildModelMessages } from '../../electron/chat/shared/messages'
import { createCompactionPacketFixture } from './compactionFixtures'
import type { Message } from '../../src/types/chat'

const messages: Message[] = [
  { id: 'u1', role: 'user', content: 'old request', timestamp: 10 },
  { id: 'a1', role: 'assistant', content: 'old answer', timestamp: 30 },
  { id: 'u2', role: 'user', content: 'second request', timestamp: 40 },
  { id: 'a2', role: 'assistant', content: 'retained answer', timestamp: 60 },
  { id: 'u3', role: 'user', content: 'future request', timestamp: 70 },
  { id: 'a3', role: 'assistant', content: 'future answer', timestamp: 90 },
]

function compaction(revision: number, anchor: string, createdAt: number): CanonicalHistoryEvent {
  const packet = createCompactionPacketFixture({ sourceDigest: `digest-${revision}`, sourceMessageIds: ['model:0'] })
  return {
    type: 'compaction_committed', branchId: 'main', eventId: `e${revision}`, runId: null,
    revision, createdAt, anchorUserMessageId: anchor, compactionId: `c${revision}`,
    modelId: 'model', providerId: 'openai', sourceDigest: packet.sourceDigest,
    sourceMessageIds: packet.sourceMessageIds, usedFallback: false,
    packet: encodeReplayValue(packet),
    projectedMessages: encodeModelMessages([{ role: 'assistant', content: packet.continuationMarkdown }]),
  }
}

function fixture() {
  const document = createEmptyCanonicalHistory('source', 1)
  document.events = [compaction(1, 'u1', 20), compaction(2, 'u2', 50), compaction(3, 'u3', 80)]
  document.revision = 3
  return document
}

test('cutoff between compactions 2 and 3 keeps snapshot 2 and retained same-turn answer', () => {
  const document = fixture()
  const retained = messages.slice(0, 4)
  const cutoff = getHistoryCutoffRevision(document, retained, messages)
  assert.equal(cutoff, 2)
  document.events.push({
    type: 'branch_created', fromBranchId: 'main', branchId: 'revert', retainedThroughRevision: cutoff,
    reason: 'history_replaced', eventId: 'fork', revision: 4, createdAt: 100, runId: null,
  }, {
    type: 'messages_synchronized', messageIds: retained.map((message) => message.id),
    branchId: 'revert', eventId: 'sync', revision: 5, createdAt: 100, runId: null,
  })
  document.activeBranchId = 'revert'
  document.revision = 5
  for (const providerId of ['openai', 'codex'] as const) {
    const result = projectCanonicalReplay({
      document, messages: retained, fallbackMessages: buildModelMessages(retained), modelId: 'changed-model', providerId,
    })
    assert.equal(result.isCompacted, true)
    assert.equal(result.compactionPacket?.sourceDigest, 'digest-2')
    assert.match(JSON.stringify(result.messages), /retained answer/)
    assert.doesNotMatch(JSON.stringify(result.messages), /future|old answer|digest-3/)
  }
})

test('repeated reverts cannot resurrect later snapshots from an ancestor or sibling', () => {
  const document = fixture()
  document.events.push({
    type: 'branch_created', fromBranchId: 'main', branchId: 'first', retainedThroughRevision: 1,
    reason: 'history_replaced', eventId: 'fork1', revision: 4, createdAt: 100, runId: null,
  }, {
    ...compaction(5, 'u1', 110), branchId: 'first',
  }, {
    type: 'branch_created', fromBranchId: 'first', branchId: 'second', retainedThroughRevision: 4,
    reason: 'history_replaced', eventId: 'fork2', revision: 6, createdAt: 120, runId: null,
  })
  document.activeBranchId = 'second'
  document.revision = 6
  assert.deepEqual(getBranchHistoryEvents(document).filter((event) => event.type === 'compaction_committed').map((event) => event.revision), [1])
})

test('editing a retained ID excludes snapshots influenced by its old content', () => {
  const document = fixture()
  const retained = [...messages.slice(0, 2), { ...messages[2], content: 'edited request' }]
  assert.equal(getHistoryCutoffRevision(document, retained, messages), 1)
})

test('same-turn compactions after the selected answer are excluded despite a retained user anchor', () => {
  const document = fixture()
  document.events[2] = compaction(3, 'u2', 80)
  assert.equal(getHistoryCutoffRevision(document, messages.slice(0, 4), messages), 2)
})

test('completed replays after a cutoff cannot leak future work through a retained user anchor', () => {
  const replay = {
    anchorUserMessageId: 'u2', branchId: 'main', contextFingerprint: '', fidelity: 'exact' as const,
    freshnessRevision: 0, messages: encodeModelMessages([{ role: 'assistant', content: 'future work' }]),
    modelId: 'model', providerId: 'openai' as const, runId: 'run', sourceRevision: 3, updatedAt: 80,
  }
  const result = carryCompletedReplaysAcrossBranch({
    activeBranchId: 'revert', sourceBranchId: 'main', messageIds: ['u1', 'u2'],
    retainedThroughRevision: 2, replay, replays: { model: replay },
  })
  assert.equal(result.replay, null)
  assert.deepEqual(result.replays, {})
})

test('existing edit and revert ancestry recovers earlier snapshots without the edited turn memory', () => {
  const document = fixture()
  document.events.push({
    type: 'branch_created', fromBranchId: 'main', branchId: 'old-edit', reason: 'edited',
    eventId: 'edit', revision: 4, createdAt: 100, runId: null,
  }, {
    type: 'messages_synchronized', messageIds: messages.slice(0, 5).map((message) => message.id),
    branchId: 'old-edit', eventId: 'edit-sync', revision: 5, createdAt: 100, runId: null,
  }, {
    type: 'branch_created', fromBranchId: 'old-edit', branchId: 'old-revert', reason: 'history_replaced',
    eventId: 'revert', revision: 6, createdAt: 110, runId: null,
  }, {
    type: 'messages_synchronized', messageIds: messages.slice(0, 4).map((message) => message.id),
    branchId: 'old-revert', eventId: 'revert-sync', revision: 7, createdAt: 110, runId: null,
  })
  document.activeBranchId = 'old-revert'
  document.revision = 7
  assert.deepEqual(getBranchHistoryEvents(document).filter((event) => event.type === 'compaction_committed').map((event) => event.revision), [1, 2])
})
