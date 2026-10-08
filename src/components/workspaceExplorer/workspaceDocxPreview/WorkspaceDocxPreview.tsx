import { lazy, memo, Suspense } from 'react'

const WorkspaceDocxPreviewView = lazy(() =>
  import('./WorkspaceDocxPreviewView').then((module) => ({ default: module.WorkspaceDocxPreviewView })),
)

interface WorkspaceDocxPreviewProps {
  fileName: string
  previewDataUrl?: string
  previewError?: string
  relativePath: string
  tabKey: string
}

export const WorkspaceDocxPreview = memo(function WorkspaceDocxPreview({
  fileName,
  previewDataUrl,
  previewError,
  relativePath,
  tabKey,
}: WorkspaceDocxPreviewProps) {
  return (
    <Suspense
      fallback={(
        <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-subtle-foreground">
          Loading {fileName}...
        </div>
      )}
    >
      <WorkspaceDocxPreviewView
        fileName={fileName}
        previewDataUrl={previewDataUrl}
        previewError={previewError}
        relativePath={relativePath}
        tabKey={tabKey}
      />
    </Suspense>
  )
})
