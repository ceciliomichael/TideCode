import type { ReactNode } from 'react'
import { WorkspaceHeader } from './layout/WorkspaceHeader'
import { InlineEditableTitle } from './chat/InlineEditableTitle'

interface ChatHeaderProps {
  title: string
  isSidebarOpen: boolean
  onRenameTitle: (nextTitle: string) => void | Promise<void>
  trailingContent?: ReactNode
}

export function ChatHeader({ title, isSidebarOpen, onRenameTitle, trailingContent }: ChatHeaderProps) {
  return (
    <WorkspaceHeader
      title={<InlineEditableTitle value={title} onSave={onRenameTitle} />}
      isSidebarOpen={isSidebarOpen}
leadingPaddingClassName={isSidebarOpen ? '' : 'pl-14 md:pl-[144px]'}
      trailingContent={trailingContent}
    />
  )
}
