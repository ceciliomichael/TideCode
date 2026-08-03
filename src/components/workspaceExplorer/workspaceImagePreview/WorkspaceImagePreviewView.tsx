import { ChevronRight } from 'lucide-react'
import { memo, useEffect, useMemo, useState } from 'react'
import { Tooltip } from '../../Tooltip'

interface WorkspaceImagePreviewViewProps {
  fileName: string
  previewDataUrl?: string
  previewError?: string
  relativePath: string
}

function getPathSegments(relativePath: string) {
  return relativePath.split(/[\\/]+/).filter((segment) => segment.length > 0)
}

export const WorkspaceImagePreviewView = memo(function WorkspaceImagePreviewView({
  fileName,
  previewDataUrl,
  previewError,
  relativePath,
}: WorkspaceImagePreviewViewProps) {
  const [hasError, setHasError] = useState(false)
  const pathSegments = useMemo(() => getPathSegments(relativePath), [relativePath])

  useEffect(() => {
    setHasError(false)
  }, [previewDataUrl])

  const imageUnavailable = !previewDataUrl || hasError

  return (
    <div className="workspace-image-preview flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <div className="flex h-7 shrink-0 items-center bg-surface px-2">
        <div className="flex min-w-0 items-center gap-1 overflow-hidden text-[12px] text-subtle-foreground">
          {pathSegments.map((segment, index) => (
            <span key={`${segment}-${index}`} className="inline-flex min-w-0 items-center gap-1.5">
              {index > 0 ? <ChevronRight size={12} className="shrink-0 text-subtle-foreground/70" /> : null}
              <Tooltip content={relativePath} side="bottom" noWrap triggerClassName="min-w-0">
                <span className="truncate">{segment}</span>
              </Tooltip>
            </span>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-background">
        <div className="flex min-h-full items-center justify-center p-4">
          {imageUnavailable ? (
            <div className="max-w-lg text-center">
              <div className="text-sm font-medium text-foreground">Image preview unavailable</div>
              <p className="mt-2 text-sm leading-6 text-subtle-foreground">
                {previewError ?? `TideCode could not render ${fileName}. You can still keep the file in your workspace.`}
              </p>
            </div>
          ) : (
            <img
              alt={fileName}
              className="block max-h-full max-w-full object-contain"
              draggable={false}
              src={previewDataUrl}
              onError={() => setHasError(true)}
            />
          )}
        </div>
      </div>
    </div>
  )
})
