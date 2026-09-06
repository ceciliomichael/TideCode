import { memo } from 'react'
import { WorkspacePdfPreviewView } from './WorkspacePdfPreviewView'

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
    <WorkspacePdfPreviewView
      fileName={fileName}
      previewDataUrl={previewDataUrl}
      previewError={previewError}
      relativePath={relativePath}
      tabKey={tabKey}
    />
  )
})
