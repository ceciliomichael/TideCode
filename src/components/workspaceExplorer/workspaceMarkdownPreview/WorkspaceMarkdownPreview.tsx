import { memo } from 'react'
import { WorkspaceMarkdownPreviewView } from './WorkspaceMarkdownPreviewView'

interface WorkspaceMarkdownPreviewProps {
  content: string
  tabKey: string
  relativePath?: string
  workspaceRootPath?: string | null
  isTruncated?: boolean
}

export const WorkspaceMarkdownPreview = memo(function WorkspaceMarkdownPreview({
  content,
  tabKey,
  relativePath,
  workspaceRootPath,
  isTruncated = false,
}: WorkspaceMarkdownPreviewProps) {
  return <WorkspaceMarkdownPreviewView tabKey={tabKey} content={content} relativePath={relativePath} workspaceRootPath={workspaceRootPath} isTruncated={isTruncated} />
})
