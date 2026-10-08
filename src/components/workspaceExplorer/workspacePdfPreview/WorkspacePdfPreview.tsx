import { lazy, memo, Suspense } from 'react'

const WorkspacePdfPreviewView = lazy(() =>
  import('./WorkspacePdfPreviewView').then((module) => ({ default: module.WorkspacePdfPreviewView })),
)

interface WorkspacePdfPreviewProps {
  fileName: string
  previewDataUrl?: string
  previewError?: string
  relativePath: string
  tabKey: string
}

export const WorkspacePdfPreview = memo(function WorkspacePdfPreview({
  fileName,
  previewDataUrl,
  previewError,
  relativePath,
  tabKey,
}: WorkspacePdfPreviewProps) {
  return (
    <Suspense
      fallback={(
        <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-subtle-foreground">
          Loading {fileName}...
        </div>
      )}
    >
      <WorkspacePdfPreviewView
        fileName={fileName}
        previewDataUrl={previewDataUrl}
        previewError={previewError}
        relativePath={relativePath}
        tabKey={tabKey}
      />
    </Suspense>
  )
})
