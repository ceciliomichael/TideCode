import { useEffect, useState } from 'react'
import type { ImageToolResultPresentation } from '../../types/chat'
import { loadToolImagePreview } from './toolImagePreview'

interface ToolImageResultProps {
  conversationId?: string | null
  presentation: ImageToolResultPresentation
  workspaceRootPath: string | null
}

type PreviewState =
  | { status: 'loading' }
  | { dataUrl: string; status: 'ready' }
  | { status: 'unavailable' }

export function ToolImageResult({ conversationId = null, presentation, workspaceRootPath }: ToolImageResultProps) {
  const [previewState, setPreviewState] = useState<PreviewState>({ status: 'loading' })
  const { fileName, kind, mediaType, relativePath } = presentation

  useEffect(() => {
    let isCurrent = true
    setPreviewState({ status: 'loading' })
    void loadToolImagePreview({
      conversationId,
      presentation: { fileName, kind, mediaType, relativePath },
      workspaceRootPath,
    }).then((previewDataUrl) => {
      if (!isCurrent) {
        return
      }
      if (previewDataUrl) {
        setPreviewState({ dataUrl: previewDataUrl, status: 'ready' })
        return
      }
      setPreviewState({ status: 'unavailable' })
    }).catch(() => {
      if (isCurrent) {
        setPreviewState({ status: 'unavailable' })
      }
    })

    return () => {
      isCurrent = false
    }
  }, [conversationId, fileName, kind, mediaType, relativePath, workspaceRootPath])

  if (previewState.status === 'loading') {
    return <div aria-label="Loading image preview" className="h-32 w-full max-w-80 rounded-lg bg-surface-muted" />
  }

  if (previewState.status === 'unavailable') {
    return <span className="text-xs text-muted-foreground">Image preview unavailable</span>
  }

  return (
    <div className="inline-flex max-w-full rounded-lg border border-border bg-surface p-1.5">
      <img
        alt={fileName}
        className="block h-auto max-h-80 w-auto max-w-full rounded-md object-contain"
        src={previewState.dataUrl}
      />
    </div>
  )
}
