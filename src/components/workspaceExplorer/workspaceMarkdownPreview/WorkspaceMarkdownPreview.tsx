import { memo } from 'react'
import { WorkspaceMarkdownPreviewView } from './WorkspaceMarkdownPreviewView'

interface WorkspaceMarkdownPreviewProps {
  content: string
  fileName: string
  relativePath?: string
  isTruncated?: boolean
}

export const WorkspaceMarkdownPreview = memo(function WorkspaceMarkdownPreview({
  content,
  fileName,
  relativePath,
  isTruncated = false,
}: WorkspaceMarkdownPreviewProps) {
  return <WorkspaceMarkdownPreviewView content={content} fileName={fileName} relativePath={relativePath} isTruncated={isTruncated} />
})
