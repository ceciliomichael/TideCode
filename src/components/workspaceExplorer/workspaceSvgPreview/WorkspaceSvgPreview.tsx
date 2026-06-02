import { memo } from 'react'
import { WorkspaceSvgPreviewView } from './WorkspaceSvgPreviewView'

interface WorkspaceSvgPreviewProps {
  content: string
  fileName: string
  relativePath: string
  isTruncated?: boolean
}

export const WorkspaceSvgPreview = memo(function WorkspaceSvgPreview({
  content,
  fileName,
  relativePath,
  isTruncated = false,
}: WorkspaceSvgPreviewProps) {
  return <WorkspaceSvgPreviewView content={content} fileName={fileName} relativePath={relativePath} isTruncated={isTruncated} />
})
