export interface PlanHandoffWorkspaceActions {
  handleCloseWorkspaceTabsByPath: (relativePath: string) => void
  handleToggleExplorerPanel: () => void
  handleMarkWorkspacePlanImplementationStarted: (relativePath: string) => Promise<boolean>
  isExplorerOpen: boolean
}

export async function persistPlanImplementationHandoff(
  relativePath: string,
  workspaceActions: PlanHandoffWorkspaceActions,
) {
  const didPersistPlanStatus = await workspaceActions.handleMarkWorkspacePlanImplementationStarted(relativePath)
  if (!didPersistPlanStatus) {
    return false
  }

  workspaceActions.handleCloseWorkspaceTabsByPath(relativePath)
  if (workspaceActions.isExplorerOpen) {
    workspaceActions.handleToggleExplorerPanel()
  }
  return true
}
