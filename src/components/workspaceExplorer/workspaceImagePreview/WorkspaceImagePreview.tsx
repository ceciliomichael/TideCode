import { memo } from 'react'
import { WorkspaceImagePreviewView } from './WorkspaceImagePreviewView'

interface WorkspaceImagePreviewProps {
  fileName: string
  previewDataUrl?: string
  previewError?: string
  relativePath: string
}

export const WorkspaceImagePreview = memo(function WorkspaceImagePreview({
  fileName,
  previewDataUrl,
  previewError,
  relativePath,
}: WorkspaceImagePreviewProps) {
  return (
    <WorkspaceImagePreviewView
      fileName={fileName}
      previewDataUrl={previewDataUrl}
      previewError={previewError}
      relativePath={relativePath}
    />
  )
})
