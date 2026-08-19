import { randomUUID } from 'node:crypto'
import type { ContextUsageEstimate, SharedRunSnapshot, SharedRunStatus, StartChatStreamInput } from '../../src/types/chat'

interface RegisteredRun {
  snapshot: SharedRunSnapshot
  providerId: StartChatStreamInput['providerId']
}

export class SharedRunRegistry {
  private readonly runsById = new Map<string, RegisteredRun>()
  private readonly runIdByStreamId = new Map<string, string>()
  private readonly runIdByConversationId = new Map<string, string>()

  create(input: StartChatStreamInput & { conversationId: string }) {
    const existingRunId = this.runIdByConversationId.get(input.conversationId)
    if (existingRunId) {
      const existing = this.runsById.get(existingRunId)
      if (existing && !this.isTerminal(existing.snapshot.status)) {
        throw new Error('A Tidecode run is already active for this conversation.')
      }
    }

    const now = Date.now()
    const runId = randomUUID()
    const snapshot: SharedRunSnapshot = {
      runId,
      streamId: null,
      conversationId: input.conversationId,
      providerId: input.providerId,
      modelId: input.modelId,
      workspaceRootPath: input.agentContextRootPath,
      contextUsage: null,
      status: 'starting',
      startedAt: now,
      updatedAt: now,
      lastEventSeq: 0,
      projectionRevision: 0,
    }
    this.runsById.set(runId, { snapshot, providerId: input.providerId })
    this.runIdByConversationId.set(input.conversationId, runId)
    return snapshot
  }

  attachStream(runId: string, streamId: string) {
    const run = this.requireRun(runId)
    run.snapshot = {
      ...run.snapshot,
      streamId,
      status: 'running',
      updatedAt: Date.now(),
    }
    this.runIdByStreamId.set(streamId, runId)
    return run.snapshot
  }

  updateStatus(runId: string, status: SharedRunStatus) {
    const run = this.requireRun(runId)
    run.snapshot = {
      ...run.snapshot,
      status,
      updatedAt: Date.now(),
    }
    return run.snapshot
  }

  updateContextUsage(runId: string, contextUsage: ContextUsageEstimate) {
    const run = this.requireRun(runId)
    run.snapshot = {
      ...run.snapshot,
      contextUsage,
      updatedAt: Date.now(),
    }
    return run.snapshot
  }

  setLastEventSeq(runId: string, lastEventSeq: number) {
    const run = this.requireRun(runId)
    run.snapshot = {
      ...run.snapshot,
      lastEventSeq,
      updatedAt: Date.now(),
    }
    return run.snapshot
  }

  setProjectionRevision(runId: string, projectionRevision: number) {
    const run = this.requireRun(runId)
    run.snapshot = {
      ...run.snapshot,
      projectionRevision,
      updatedAt: Date.now(),
    }
    return run.snapshot
  }

  getByRunId(runId: string) {
    return this.runsById.get(runId)?.snapshot ?? null
  }

  getByStreamId(streamId: string) {
    const runId = this.runIdByStreamId.get(streamId)
    return runId ? this.runsById.get(runId)?.snapshot ?? null : null
  }

  getProviderByStreamId(streamId: string) {
    const runId = this.runIdByStreamId.get(streamId)
    return runId ? this.runsById.get(runId)?.providerId ?? null : null
  }

  listActive() {
    return Array.from(this.runsById.values())
      .map((entry) => entry.snapshot)
      .filter((run) => !this.isTerminal(run.status))
      .sort((left, right) => right.updatedAt - left.updatedAt)
  }

  remove(runId: string) {
    const run = this.runsById.get(runId)
    if (!run) return
    this.runsById.delete(runId)
    if (run.snapshot.streamId) this.runIdByStreamId.delete(run.snapshot.streamId)
    if (this.runIdByConversationId.get(run.snapshot.conversationId) === runId) {
      this.runIdByConversationId.delete(run.snapshot.conversationId)
    }
  }

  private requireRun(runId: string) {
    const run = this.runsById.get(runId)
    if (!run) throw new Error(`Unknown Tidecode run: ${runId}`)
    return run
  }

  private isTerminal(status: SharedRunStatus) {
    return status === 'completed'
      || status === 'failed'
      || status === 'cancelled'
      || status === 'interrupted'
  }
}
