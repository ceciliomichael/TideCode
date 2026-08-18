import { Archive, FolderOpen, MessageSquareText } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ARCHIVED_FOLDER_ID, PINNED_FOLDER_ID } from '../../hooks/chatHistoryViewModels'
import type { ConversationGroupPreview } from '../../types/chat'
import { ConversationHistoryItem } from './ConversationHistoryItem'
import {
  ALL_PROJECTS_FILTER_ID,
  ARCHIVED_PROJECT_FILTER_ID,
  buildSidebarThreadRows,
  resolveSidebarHistoryEmptyState,
} from './sidebarProjectThreads'

interface ConversationHistoryListProps {
  conversationGroups: ConversationGroupPreview[]
  onArchiveConversation: (conversationId: string, isArchived: boolean) => void
  onDeleteConversation: (conversationId: string) => void
  isLoading?: boolean
  onPinConversation: (conversationId: string, isPinned: boolean) => void
  onSelectConversation: (conversationId: string) => void
  searchQuery: string
  selectedProjectId: string
}

const THREAD_BATCH_SIZE = 40

export function ConversationHistoryList({
  conversationGroups,
  onSelectConversation,
  onArchiveConversation,
  onDeleteConversation,
  isLoading = false,
  onPinConversation,
  searchQuery,
  selectedProjectId,
}: ConversationHistoryListProps) {
  const [visibleThreadCount, setVisibleThreadCount] = useState(THREAD_BATCH_SIZE)
  const threadRows = useMemo(
    () => buildSidebarThreadRows(conversationGroups, selectedProjectId, searchQuery),
    [conversationGroups, searchQuery, selectedProjectId],
  )
  const visibleThreadRows = threadRows.slice(0, visibleThreadCount)
  const remainingThreadCount = threadRows.length - visibleThreadRows.length
  const isAllProjectsView = selectedProjectId === ALL_PROJECTS_FILTER_ID
  const isArchivedView = selectedProjectId === ARCHIVED_PROJECT_FILTER_ID
  const hasProjects = conversationGroups.some(
    (group) => group.folder.id !== null && group.folder.id !== PINNED_FOLDER_ID && group.folder.id !== ARCHIVED_FOLDER_ID,
  )

  useEffect(() => {
    setVisibleThreadCount(THREAD_BATCH_SIZE)
  }, [searchQuery, selectedProjectId])

  if (threadRows.length === 0) {
    const emptyState = resolveSidebarHistoryEmptyState({
      hasProjects,
      isLoading,
      searchQuery,
      selectedProjectId,
    })

    if (emptyState === 'loading') {
      return (
        <div className="flex min-h-full flex-1 items-center justify-center px-4 py-8 text-center">
          <p className="text-sm text-subtle-foreground">Loading threads...</p>
        </div>
      )
    }

    return (
      <div className="flex min-h-full flex-1 items-center justify-center px-4 py-8 text-center">
        <div className="flex max-w-[240px] flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface-muted text-subtle-foreground">
            {isArchivedView ? <Archive size={22} /> : hasProjects ? <MessageSquareText size={22} /> : <FolderOpen size={22} />}
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              {emptyState === 'no-matches'
                ? 'No matching threads'
                : emptyState === 'no-archived'
                  ? 'No archived chats'
                  : emptyState === 'no-threads'
                    ? 'No threads here yet'
                    : 'No projects yet'}
            </p>
            <p className="text-sm leading-6 text-subtle-foreground">
              {emptyState === 'no-matches'
                ? 'Try another title or project name'
                : emptyState === 'no-archived'
                  ? 'Archived chats will appear here when you archive a thread'
                  : emptyState === 'no-threads'
                    ? 'Start a thread in this project to see it here'
                    : 'Add a project folder to start a thread'}
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1.5 pb-1">
      {visibleThreadRows.map(({ conversation, workspaceName }) => (
        <ConversationHistoryItem
          key={conversation.id}
          conversation={conversation}
          workspaceName={isAllProjectsView || isArchivedView ? workspaceName : undefined}
          onSelectConversation={onSelectConversation}
          onArchiveConversation={onArchiveConversation}
          onDeleteConversation={onDeleteConversation}
          onPinConversation={onPinConversation}
        />
      ))}
      {remainingThreadCount > 0 ? (
        <div className="px-4 py-2">
          <button
            type="button"
            onClick={() => setVisibleThreadCount((currentValue) => currentValue + THREAD_BATCH_SIZE)}
            className="min-h-10 rounded-lg px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-[var(--sidebar-hover-surface)] hover:text-foreground"
          >
            Show {Math.min(remainingThreadCount, THREAD_BATCH_SIZE)} more
          </button>
        </div>
      ) : null}
    </div>
  )
}
