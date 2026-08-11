import { useEffect, useState } from 'react'
import type { ImageToolResultPresentation } from '../../types/chat'

interface ToolImageResultProps {
  presentation: ImageToolResultPresentation
  workspaceRootPath: string | null
}

type PreviewState =
  | { status: 'loading' }
  | { dataUrl: string; status: 'ready' }
  | { status: 'unavailable' }

export function ToolImageResult({ presentation, workspaceRootPath }: ToolImageResultProps) {
  const [previewState, setPreviewState] = useState<PreviewState>({ status: 'loading' })

  useEffect(() => {
    let isCurrent = true
    if (!workspaceRootPath) {
      setPreviewState({ status: 'unavailable' })
      return () => {
        isCurrent = false
      }
    }

    setPreviewState({ status: 'loading' })
    void window.tidecodeWorkspace.readFile({
      relativePath: presentation.relativePath,
      workspaceRootPath,
    }).then((result) => {
      if (!isCurrent) {
        return
      }
      if (result.status === 'ready' && result.previewDataUrl) {
        setPreviewState({ dataUrl: result.previewDataUrl, status: 'ready' })
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
  }, [presentation.relativePath, workspaceRootPath])

  if (previewState.status === 'loading') {
    return <div aria-label="Loading image preview" className="h-32 w-full max-w-80 rounded-lg bg-surface-muted" />
  }

  if (previewState.status === 'unavailable') {
    return <span className="text-xs text-muted-foreground">Image preview unavailable</span>
  }

  return (
    <div className="inline-flex max-w-full rounded-lg border border-border bg-surface p-1.5">
      <img
        alt={presentation.fileName}
        className="block h-auto max-h-80 w-auto max-w-full rounded-md object-contain"
        src={previewState.dataUrl}
      />
    </div>
  )
}
