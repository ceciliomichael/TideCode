export function notifyWorkspaceExplorerChange(workspaceRootPath: string) {
  void import('./explorerWatch')
    .then((watchModule) => {
      watchModule.notifyWorkspaceExplorerChange(workspaceRootPath)
    })
    .catch((error: unknown) => {
      console.error('Failed to notify workspace explorer change', error)
    })
}
