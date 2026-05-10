import { useSyncExternalStore } from 'react'
import {
  getSourceControlPendingStateSnapshot,
  subscribeSourceControlPendingState,
  type SourceControlWorkspacePendingState,
} from '../lib/sourceControlPendingStateStore'

export function useSourceControlPendingState(
  workspacePath: string | null | undefined,
): SourceControlWorkspacePendingState | null {
  return useSyncExternalStore(
    subscribeSourceControlPendingState,
    () => getSourceControlPendingStateSnapshot(workspacePath),
    () => null,
  )
}
