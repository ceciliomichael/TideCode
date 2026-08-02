export type SourceControlPrimaryAction = 'commit' | 'publish-to-github' | 'sync-changes'

export interface SourceControlPrimaryActionInput {
  aheadCommitCount: number
  hasRemote: boolean
  stagedFileCount: number
  unstagedFileCount: number
}
export function getSourceControlPrimaryAction(input: SourceControlPrimaryActionInput): SourceControlPrimaryAction {
  const hasWorkingTreeChanges = input.stagedFileCount > 0 || input.unstagedFileCount > 0

  if (!hasWorkingTreeChanges && input.hasRemote && input.aheadCommitCount > 0) {
    return 'sync-changes'
  }

  if (!hasWorkingTreeChanges && !input.hasRemote) {
    return 'publish-to-github'
  }

  return 'commit'
}
