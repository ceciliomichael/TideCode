import { randomUUID } from 'node:crypto'
import type { PreparedContextRequest } from '../contextRequest'
import type { CompactionResult, CompactionAttemptDiagnostic, CompactionReason, CompactionWindow } from './contracts'
import { requiresContextCompaction, shouldCompactContext } from './budget'
import { CompactionError, assertContextAdmission } from './gate'
import { selectCompactionWindowResult, hasUnresolvedToolCall, buildCompactionSourceDigest } from './window'
import { retainedMessageTokens } from './conversationRetention'
import { minimumCompactionRetentionTokens } from './service'
import type { CompactionPacket } from './contracts'

export interface CompactionSession {
  preferredAttempted: boolean
  requiredFingerprint: string | null
}

export function createCompactionSession(): CompactionSession {
  return { preferredAttempted: false, requiredFingerprint: null }
}

export type CoordinatedCompaction =
  | { status: 'not_needed' | 'deferred'; reason: CompactionReason | null }
  | { status: 'compacted'; result: CompactionResult; request: PreparedContextRequest; diagnostic: CompactionAttemptDiagnostic }
  | { status: 'aborted'; reason: 'aborted' }

export async function coordinateCompaction(input: {
  request: PreparedContextRequest
  session: CompactionSession
  previousPacket: CompactionPacket | null
  retainedContextTokens: number
  manual?: boolean
  signal?: AbortSignal
  run: (window: CompactionWindow, targetTokens: number, diagnostic: CompactionAttemptDiagnostic) => Promise<CompactionResult | null>
  rebuild: (result: CompactionResult) => Promise<PreparedContextRequest>
  commit: (result: CompactionResult, diagnostic: CompactionAttemptDiagnostic) => Promise<void>
  report: (diagnostic: CompactionAttemptDiagnostic) => Promise<void>
  onStarted?: (attemptId: string) => void
  onFinished?: (diagnostic: CompactionAttemptDiagnostic) => void
}): Promise<CoordinatedCompaction> {
  if (input.signal?.aborted) {
    return { status: 'aborted', reason: 'aborted' }
  }
  const budget = input.request.state.budget
  const required = requiresContextCompaction(budget)
  const invalidPairs = hasUnresolvedToolCall(input.request.durableMessages)
  if (!invalidPairs && !input.manual && !shouldCompactContext(budget)) {
    return { status: 'not_needed', reason: null }
  }
  if (!invalidPairs && !input.manual && !required && input.session.preferredAttempted) {
    return { status: 'deferred', reason: null }
  }
  if (required && input.session.requiredFingerprint === input.request.fingerprint) {
    throw new CompactionError('insufficient_reduction')
  }
  const startedAt = performance.now()
  let mode: CompactionAttemptDiagnostic['mode'] = 'preferred'
  if (input.manual) {
    mode = 'manual'
  } else if (required) {
    mode = 'required'
  }
  const diagnostic: CompactionAttemptDiagnostic = {
    attemptId: randomUUID(),
    mode,
    reason: null,
    outcome: 'deferred',
    beforeTokens: budget.totalTokens,
    afterTokens: null,
    admissionTokens: budget.admissionTokens,
    outputReserveTokens: budget.outputReserveTokens,
    uncertaintyTokens: budget.uncertaintyTokens + budget.correctionTokens,
    durationMs: 0,
    workerUsage: [],
  }
  let didStart = false
  try {
    if (invalidPairs) {
      throw new CompactionError('invalid_tool_pairs')
    }
    const visualTokens = retainedMessageTokens(input.request.visualMessages)
    const available = budget.availableHistoryTokens - visualTokens
    const protectedTarget = minimumCompactionRetentionTokens(
      input.request.durableMessages, input.previousPacket, input.manual ? 'settled' : 'active',
    )
    if (protectedTarget > available) {
      throw new CompactionError('protected_context_too_large')
    }
    const target = Math.min(available, Math.max(input.retainedContextTokens, protectedTarget))
    const selection = selectCompactionWindowResult(input.request.durableMessages, target, {
      previousPacket: input.previousPacket,
      retainedContextTokens: target,
      force: input.manual,
    })
    if (!selection.window) {
      throw new CompactionError(selection.reason)
    }
    diagnostic.sourceDigest = buildCompactionSourceDigest(input.request.durableMessages, selection.window.sourceEndIndex, selection.window.sourceStartIndex)
    if (required) {
      input.session.requiredFingerprint = input.request.fingerprint
    } else if (!input.manual) {
      input.session.preferredAttempted = true
    }
    didStart = true
    input.onStarted?.(diagnostic.attemptId)
    const result = await input.run(selection.window, target, diagnostic)
    if (input.signal?.aborted) {
      throw new CompactionError('aborted')
    }
    if (!result) {
      throw new CompactionError('no_compactable_source')
    }
    const request = await input.rebuild(result)
    const projected = request.state.budget
    diagnostic.afterTokens = projected.totalTokens
    if (hasUnresolvedToolCall(request.requestMessages)) {
      throw new CompactionError('invalid_tool_pairs')
    }
    assertContextAdmission(projected)
    const saving = budget.totalTokens - projected.totalTokens
    if (saving <= 0 || (!required && !input.manual && (
      saving < budget.minimumSavingTokens
      || projected.totalTokens > budget.triggerTokens - budget.minimumSavingTokens
    ))) {
      throw new CompactionError('insufficient_reduction')
    }
    if (input.signal?.aborted) {
      throw new CompactionError('aborted')
    }
    diagnostic.outcome = 'compacted'
    diagnostic.durationMs = performance.now() - startedAt
    try {
      await input.commit(result, diagnostic)
    } catch (error) {
      if (error instanceof CompactionError) {
        throw error
      }
      throw new CompactionError('commit_failed', { cause: error })
    }
    input.session.preferredAttempted = false
    input.session.requiredFingerprint = null
    return { status: 'compacted', result, request, diagnostic }
  } catch (error) {
    let reason: CompactionReason = 'worker_error'
    if (error instanceof CompactionError) {
      reason = error.reason
    }
    if (input.signal?.aborted) {
      reason = 'aborted'
    }
    diagnostic.reason = reason
    if (reason === 'aborted') {
      diagnostic.outcome = 'aborted'
    } else if (required || input.manual || reason === 'invalid_tool_pairs' || reason === 'stale_source') {
      diagnostic.outcome = 'blocked'
    } else {
      diagnostic.outcome = 'deferred'
    }
    diagnostic.durationMs = performance.now() - startedAt
    // Failed diagnostic persistence cannot make an optional safe request fatal.
    await input.report(diagnostic).catch(() => undefined)
    if (didStart) {
      input.onFinished?.(diagnostic)
    }
    if (reason === 'aborted') {
      return { status: 'aborted', reason }
    }
    if (required || input.manual || reason === 'invalid_tool_pairs' || reason === 'stale_source') {
      throw new CompactionError(reason, { cause: error })
    }
    return { status: 'deferred', reason }
  }
}
