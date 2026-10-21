import { useEffect, useState } from 'react'
import type { ChatImageAttachment, ImageToolResultPresentation } from '../../types/chat'
import { loadToolImagePreview } from './toolImagePreview'

type ChatMentionImageHoverContentProps =
  | {
      attachment: ChatImageAttachment
      conversationId?: never
      presentation?: never
      workspaceRootPath?: never
    }
  | {
      attachment?: never
      conversationId?: string | null
      presentation: ImageToolResultPresentation
      workspaceRootPath: string | null
    }

export function ChatMentionImageHoverContent({
  attachment,
  conversationId,
  presentation,
  workspaceRootPath,
}: ChatMentionImageHoverContentProps) {
  const [previewState, setPreviewState] = useState<{
    dataUrl: string | null
    status: 'loading' | 'ready' | 'unavailable'
  }>({ dataUrl: null, status: 'loading' })
  const fileName = presentation?.fileName
  const mediaType = presentation?.mediaType
  const relativePath = presentation?.relativePath

  useEffect(() => {
    if (!fileName || !mediaType || !relativePath) {
      setPreviewState({ dataUrl: null, status: 'unavailable' })
      return
    }

    let isCurrent = true
    setPreviewState({ dataUrl: null, status: 'loading' })
    void loadToolImagePreview({
      conversationId,
      presentation: {
        fileName,
        kind: 'image',
        mediaType,
        relativePath,
      },
      workspaceRootPath: workspaceRootPath ?? null,
    }).then((dataUrl) => {
      if (isCurrent) {
        setPreviewState({ dataUrl, status: dataUrl ? 'ready' : 'unavailable' })
      }
    }).catch(() => {
      if (isCurrent) {
        setPreviewState({ dataUrl: null, status: 'unavailable' })
      }
    })

    return () => {
      isCurrent = false
    }
  }, [conversationId, fileName, mediaType, relativePath, workspaceRootPath])

  if (presentation && previewState.status === 'loading') {
    return <span className="text-xs text-muted-foreground">Loading image preview…</span>
  }
  if (presentation && previewState.status === 'unavailable') {
    return <span className="text-xs text-muted-foreground">Image preview unavailable</span>
  }

  const src = attachment?.dataUrl ?? previewState.dataUrl
  const alt = attachment?.fileName ?? presentation?.fileName ?? 'Image preview'
  if (!src) {
    return <span className="text-xs text-muted-foreground">Image preview unavailable</span>
  }

  return (
    <img
      src={src}
      alt={alt}
      className="block h-auto w-auto max-h-[min(20rem,calc(100vh-3rem))] max-w-[min(24rem,calc(100vw-3rem))] rounded-md object-contain"
    />
  )
}
