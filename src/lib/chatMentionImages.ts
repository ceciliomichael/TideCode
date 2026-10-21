import type { ChatImageAttachment, ImageToolResultPresentation } from '../types/chat'
import { getChatMentionTarget } from './chatMentions'
import { getImagePreviewMimeType } from './image-preview'
import { getPathBasename } from './pathPresentation'
import { getStagedChatImagePath } from './chatStagedImageMentions'

export function findChatMentionImageAttachment(
  path: string,
  imageAttachments: readonly ChatImageAttachment[],
) {
  const attachmentPath = path.startsWith('tools.read:') ? path.slice('tools.read:'.length) : path
  return imageAttachments.find((attachment) =>
    (attachment.path ?? getStagedChatImagePath(attachment)) === attachmentPath,
  ) ?? null
}

export function getChatMentionImagePreview(path: string, workspaceRootPath?: string | null) {
  if (
    path.startsWith('tools.skill.load:') ||
    path.startsWith('load_skill:') ||
    path.startsWith('tools.available.search:')
  ) {
    return null
  }

  const targetPath = getChatMentionTarget(path)
  if (targetPath.startsWith('@skills/')) {
    return null
  }

  const mediaType = getImagePreviewMimeType(targetPath)
  if (!mediaType) {
    return null
  }

  let relativePath = targetPath
  let previewWorkspaceRootPath = workspaceRootPath ?? null
  if (targetPath.startsWith('@workspace/')) {
    const [, mentionWorkspaceName, ...pathSegments] = targetPath.split('/')
    const currentWorkspaceName = previewWorkspaceRootPath
      ? getPathBasename(previewWorkspaceRootPath)
      : ''
    if (mentionWorkspaceName === currentWorkspaceName && pathSegments.length > 0) {
      relativePath = pathSegments.join('/')
    } else {
      previewWorkspaceRootPath = null
    }
  }

  const presentation: ImageToolResultPresentation = {
    fileName: getPathBasename(targetPath),
    kind: 'image',
    mediaType,
    relativePath,
  }

  return {
    presentation,
    workspaceRootPath: previewWorkspaceRootPath,
  }
}
