export const DEFAULT_WORKSPACE_EDITOR_WIDTH = 760
export const MIN_WORKSPACE_EDITOR_WIDTH = 200
export const MAX_WORKSPACE_EDITOR_WIDTH = 1400
export const MIN_CHAT_INTERFACE_WIDTH = 320

export function getMinWorkspaceEditorWidth(parentWidth: number) {
  return Math.max(MIN_WORKSPACE_EDITOR_WIDTH, Math.round(parentWidth * 0.25))
}

export function getMaxWorkspaceEditorWidth(parentWidth: number) {
  const widthFromAvailableSpace = Math.round(parentWidth - MIN_CHAT_INTERFACE_WIDTH)
  return Math.max(
    getMinWorkspaceEditorWidth(parentWidth),
    Math.min(MAX_WORKSPACE_EDITOR_WIDTH, widthFromAvailableSpace),
  )
}

export function clampWorkspaceEditorWidth(editorWidth: number, parentWidth: number) {
  return Math.min(
    Math.max(Math.round(editorWidth), getMinWorkspaceEditorWidth(parentWidth)),
    getMaxWorkspaceEditorWidth(parentWidth),
  )
}

export function clampStoredWorkspaceEditorWidth(editorWidth: number) {
  return Math.max(MIN_WORKSPACE_EDITOR_WIDTH, Math.round(editorWidth))
}
