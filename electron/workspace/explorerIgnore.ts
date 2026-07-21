export const WORKSPACE_EXPLORER_TEMPORARY_DELETE_MARKER = '.echodeleting_'

export function isWorkspaceExplorerTemporaryDeletingEntryName(entryName: string) {
  return entryName.includes(WORKSPACE_EXPLORER_TEMPORARY_DELETE_MARKER)
}
