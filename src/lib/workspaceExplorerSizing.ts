import { MAX_DIFF_PANEL_WIDTH } from './diffPanelSizing'

export const DEFAULT_WORKSPACE_EXPLORER_WIDTH = 360
export const MIN_WORKSPACE_EXPLORER_WIDTH = 100
export const MAX_WORKSPACE_EXPLORER_WIDTH = MAX_DIFF_PANEL_WIDTH

export function getMinWorkspaceExplorerWidth(viewportWidth: number) {
  return Math.max(MIN_WORKSPACE_EXPLORER_WIDTH, Math.round(viewportWidth * 0.20))
}

export function getMaxWorkspaceExplorerWidth(viewportWidth: number) {
  const softMax = Math.round(viewportWidth * 0.75)
  return Math.max(getMinWorkspaceExplorerWidth(viewportWidth), Math.min(MAX_WORKSPACE_EXPLORER_WIDTH, softMax))
}

export function clampWorkspaceExplorerWidth(explorerWidth: number, viewportWidth: number) {
  return Math.min(
    Math.max(Math.round(explorerWidth), getMinWorkspaceExplorerWidth(viewportWidth)),
    getMaxWorkspaceExplorerWidth(viewportWidth),
  )
}

export function clampStoredWorkspaceExplorerWidth(explorerWidth: number) {
  return Math.max(MIN_WORKSPACE_EXPLORER_WIDTH, Math.round(explorerWidth))
}
