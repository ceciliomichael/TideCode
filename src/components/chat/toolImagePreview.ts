import type { ImageToolResultPresentation } from '../../types/chat'

export async function loadToolImagePreview(input: {
  conversationId?: string | null
  presentation: ImageToolResultPresentation
  workspaceRootPath: string | null
}) {
  const isAttachmentPath = input.presentation.relativePath.startsWith('@attachments/')
  if (isAttachmentPath) {
    if (!input.conversationId) {
      return null
    }
    return window.tidecodeHistory.readChatAttachmentImagePreview(
      input.conversationId,
      input.presentation.relativePath,
    )
  }
  if (/^(?:[a-zA-Z]:[\\/]|\\\\|\/)/u.test(input.presentation.relativePath)) {
    return window.tidecodeWorkspace.readToolImagePreview(input.presentation.relativePath)
  }
  if (!input.workspaceRootPath) {
    return null
  }
  const result = await window.tidecodeWorkspace.readFile({
    relativePath: input.presentation.relativePath,
    workspaceRootPath: input.workspaceRootPath,
  })
  return result.status === 'ready' ? result.previewDataUrl ?? null : null
}
