import { memo } from 'react'
import { WorkspaceSvgPreviewView } from './WorkspaceSvgPreviewView'

interface WorkspaceSvgPreviewProps {
  content: string
  fileName: string
  relativePath: string
  tabKey: string
  isTruncated?: boolean
}

export const WorkspaceSvgPreview = memo(function WorkspaceSvgPreview({
  content,
  fileName,
  relativePath,
  tabKey,
  isTruncated = false,
}: WorkspaceSvgPreviewProps) {
  return <WorkspaceSvgPreviewView tabKey={tabKey} content={content} fileName={fileName} relativePath={relativePath} isTruncated={isTruncated} />
})
