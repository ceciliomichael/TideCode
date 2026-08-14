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
 * user-message anchor is still present. Reconstructing from run_started is
 * only a safe fallback because run_started contains the pre-response prompt.
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
