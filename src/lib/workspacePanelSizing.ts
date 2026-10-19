import { MIN_CHAT_PANEL_WIDTH } from './chatPanelSizing'
import { MIN_WORKSPACE_EDITOR_WIDTH } from './workspaceEditorSizing'

export function getWorkspacePanelBounds(
  availableWidth: number,
  reservedWidth: number,
  minimumWidth: number,
  maximumWidth: number,
) {
  const remainingWidth = Math.max(0, Math.floor(availableWidth - reservedWidth))
  const maxWidth = Math.min(maximumWidth, remainingWidth)
  return { minWidth: Math.min(minimumWidth, maxWidth), maxWidth }
}

// Chat has a fixed width beside an editor; the editor may shrink to its minimum.
// Other side panels reserve their rendered width, so resizing one cannot move another.
function getWorkspacePanelReservedWidth(panel: HTMLElement) {
  let reservedWidth = 0
  for (const sibling of Array.from(panel.parentElement?.children ?? [])) {
    if (!(sibling instanceof HTMLElement) || sibling === panel) {
      continue
    }
    const style = getComputedStyle(sibling)
    if (style.display === 'none' || style.position === 'absolute') {
      continue
    }
    if (sibling.hasAttribute('data-chat-panel')) {
      const chatWidth = sibling.dataset.fixedWidth === 'true' ? sibling.getBoundingClientRect().width : 0
      reservedWidth += Math.max(MIN_CHAT_PANEL_WIDTH, chatWidth)
    } else if (sibling.hasAttribute('data-workspace-editor')) {
      reservedWidth += MIN_WORKSPACE_EDITOR_WIDTH
    } else {
      reservedWidth += sibling.getBoundingClientRect().width
    }
  }
  return reservedWidth
}

export function clampWorkspacePanelWidth(panel: HTMLElement, width: number, minimumWidth: number, maximumWidth: number) {
  const bounds = getWorkspacePanelBounds(
    panel.parentElement?.clientWidth ?? 0,
    getWorkspacePanelReservedWidth(panel),
    minimumWidth,
    maximumWidth,
  )
  return Math.min(bounds.maxWidth, Math.max(bounds.minWidth, Math.round(width)))
}
