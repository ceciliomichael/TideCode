export interface WorkspaceMonacoModifierEvent {
  ctrlKey: boolean
  metaKey: boolean
}

export function readWorkspaceMonacoModifierPressed(event: WorkspaceMonacoModifierEvent) {
  return event.ctrlKey || event.metaKey
}

export function latchWorkspaceMonacoModifierPressed(
  current: boolean,
  event: WorkspaceMonacoModifierEvent,
) {
  return current || readWorkspaceMonacoModifierPressed(event)
}
