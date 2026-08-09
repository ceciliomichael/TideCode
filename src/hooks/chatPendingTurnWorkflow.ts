export interface StopAndRollbackPendingTurnInput {
  abortActiveRun: () => Promise<void>
  prepareLocalRollback: () => void
  rollbackPersistedTurn: () => Promise<void>
}

export async function stopAndRollbackPendingTurn({
  abortActiveRun,
  prepareLocalRollback,
  rollbackPersistedTurn,
}: StopAndRollbackPendingTurnInput) {
  prepareLocalRollback()

  let abortError: unknown = null
  try {
    await abortActiveRun()
  } catch (caughtError) {
    abortError = caughtError
  }

  let rollbackError: unknown = null
  try {
    await rollbackPersistedTurn()
  } catch (caughtError) {
    rollbackError = caughtError
  }

  if (abortError) {
    throw abortError
  }

  if (rollbackError) {
    throw rollbackError
  }
}
