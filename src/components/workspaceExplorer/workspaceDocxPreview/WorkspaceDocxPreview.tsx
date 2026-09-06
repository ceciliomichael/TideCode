import { memo } from 'react'
import { WorkspaceDocxPreviewView } from './WorkspaceDocxPreviewView'

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
    <WorkspaceDocxPreviewView
      fileName={fileName}
      previewDataUrl={previewDataUrl}
      previewError={previewError}
      relativePath={relativePath}
      tabKey={tabKey}
    />
  )
})
