import { memo } from 'react'
import { WorkspaceDocxPreviewView } from './WorkspaceDocxPreviewView'

interface WorkspaceDocxPreviewProps {
  fileName: string
  previewDataUrl?: string
  previewError?: string
  relativePath: string
}

export const WorkspaceDocxPreview = memo(function WorkspaceDocxPreview({
  fileName,
  previewDataUrl,
  previewError,
  relativePath,
}: WorkspaceDocxPreviewProps) {
  return (
    <WorkspaceDocxPreviewView
      fileName={fileName}
      previewDataUrl={previewDataUrl}
      previewError={previewError}
      relativePath={relativePath}
    />
  )
})
