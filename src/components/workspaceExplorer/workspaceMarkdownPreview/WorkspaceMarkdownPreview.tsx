import { memo } from 'react'
import { WorkspaceMarkdownPreviewView } from './WorkspaceMarkdownPreviewView'

interface WorkspaceMarkdownPreviewProps {
  content: string
  relativePath?: string
  workspaceRootPath?: string | null
  isTruncated?: boolean
}

export const WorkspaceMarkdownPreview = memo(function WorkspaceMarkdownPreview({
  content,
  relativePath,
  workspaceRootPath,
  isTruncated = false,
}: WorkspaceMarkdownPreviewProps) {
  return <WorkspaceMarkdownPreviewView content={content} relativePath={relativePath} workspaceRootPath={workspaceRootPath} isTruncated={isTruncated} />
})
