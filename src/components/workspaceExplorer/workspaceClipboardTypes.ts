export interface WorkspaceClipboardEntry {
  mode: 'copy' | 'cut'
  relativePaths: string[]
  sourceWorkspaceRootPath: string
}
