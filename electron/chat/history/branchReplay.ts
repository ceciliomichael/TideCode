import type {
  CanonicalReplayProjection,
} from './contracts'

export interface BranchReplayCarryForwardInput {
  activeBranchId: string
  messageIds: readonly string[]
  replay: CanonicalReplayProjection | null
  replays: Readonly<Record<string, CanonicalReplayProjection>>
}

export interface BranchReplayCarryForwardResult {
  replay: CanonicalReplayProjection | null
  replays: Record<string, CanonicalReplayProjection>
}

export interface BranchReplayAfterRewriteInput extends BranchReplayCarryForwardInput {
  wasEdited: boolean
}

function canReplayAgainstMessages(
  replay: CanonicalReplayProjection,
  messageIds: ReadonlySet<string>,
) {
  return replay.anchorUserMessageId !== null && messageIds.has(replay.anchorUserMessageId)
}

function rebaseReplayProjection(
  replay: CanonicalReplayProjection,
  activeBranchId: string,
) {
  return {
    ...replay,
    branchId: activeBranchId,
  }
}

/**
 * A rollback branch should retain the last completed model replay when its
 * user-message anchor is still present. Pre-response run_started snapshots are
 * not completed replays and must never be synthesized as branch history.
 */
export function carryCompletedReplaysAcrossBranch(
  input: BranchReplayCarryForwardInput,
): BranchReplayCarryForwardResult {
  const messageIds = new Set(input.messageIds)
  const replays = Object.fromEntries(
    Object.entries(input.replays)
      .filter(([, replay]) => canReplayAgainstMessages(replay, messageIds))
      .map(([slotKey, replay]) => [slotKey, rebaseReplayProjection(replay, input.activeBranchId)]),
  )
  const replay = input.replay && canReplayAgainstMessages(input.replay, messageIds)
    ? rebaseReplayProjection(input.replay, input.activeBranchId)
    : null

  return { replay, replays }
}

/**
 * Rewrites must never synthesize a replay from run_started. That event is only
 * the pre-response prompt, so using it after a revert silently drops completed
 * assistant/tool output that still exists in durable conversation history. If
 * no completed replay survives the branch, leave replay empty and let the
 * projector rebuild from the retained Message[] transcript.
 */
export function resolveReplayStateAfterHistoryRewrite(
  input: BranchReplayAfterRewriteInput,
): BranchReplayCarryForwardResult {
  if (input.wasEdited) {
    return { replay: null, replays: {} }
  }

  return carryCompletedReplaysAcrossBranch(input)
}
