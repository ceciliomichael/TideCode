import { ChevronRight } from 'lucide-react'
import { memo, useMemo, useState } from 'react'

interface WorkspaceSvgPreviewViewProps {
  content: string
  fileName: string
  relativePath: string
  isTruncated?: boolean
}

function createSvgDataUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function getPathSegments(relativePath: string) {
  return relativePath.split(/[\\/]+/).filter((segment) => segment.length > 0)
}

export const WorkspaceSvgPreviewView = memo(function WorkspaceSvgPreviewView({
  content,
  fileName,
  relativePath,
  isTruncated = false,
}: WorkspaceSvgPreviewViewProps) {
  const [hasError, setHasError] = useState(false)
  const svgSource = useMemo(() => createSvgDataUrl(content), [content])
  const pathSegments = useMemo(() => getPathSegments(relativePath), [relativePath])

  return (
    <div className="workspace-svg-preview flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <div className="flex h-7 shrink-0 items-center bg-surface px-2">
        <div className="flex min-w-0 items-center gap-1 overflow-hidden text-[12px] text-subtle-foreground">
          {pathSegments.map((segment, index) => (
            <span key={`${segment}-${index}`} className="inline-flex min-w-0 items-center gap-1.5">
              {index > 0 ? <ChevronRight size={12} className="shrink-0 text-subtle-foreground/70" /> : null}
              <span className="truncate" title={relativePath}>
                {segment}
              </span>
            </span>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {isTruncated ? (
          <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            This document is truncated. Save the file outside the workspace limit to see the full image.
          </div>
        ) : null}

        <div className="flex min-h-full items-center justify-center p-2">
          {hasError ? (
            <div className="max-w-lg text-center">
              <div className="text-sm font-medium text-foreground">SVG preview unavailable</div>
              <p className="mt-2 text-sm leading-6 text-subtle-foreground">
                The file could not be rendered as SVG. You can still edit the raw source in the file editor.
              </p>
            </div>
          ) : (
            <img
              alt={fileName}
              src={svgSource}
              onError={() => setHasError(true)}
              className="max-h-full max-w-full object-contain"
            />
          )}
        </div>
      </div>
    </div>
  )
})
