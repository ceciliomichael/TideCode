import { memo } from 'react'
import { WorkspaceMarkdownPreviewView } from './WorkspaceMarkdownPreviewView'

interface WorkspaceMarkdownPreviewProps {
  content: string
  fileName: string
  relativePath?: string
  workspaceRootPath?: string | null
  isTruncated?: boolean
}

export const WorkspaceMarkdownPreview = memo(function WorkspaceMarkdownPreview({
  content,
  fileName,
  relativePath,
  workspaceRootPath,
  isTruncated = false,
}: WorkspaceMarkdownPreviewProps) {
  return <WorkspaceMarkdownPreviewView content={content} fileName={fileName} relativePath={relativePath} workspaceRootPath={workspaceRootPath} isTruncated={isTruncated} />
})
