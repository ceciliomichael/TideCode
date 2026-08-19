import { Download, FolderPlus, Settings, SquarePen } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent } from 'react'
import { getExternalFilePaths } from '../../lib/externalFileDrop'
import { Tooltip } from '../Tooltip'
import type { ConversationGroupPreview } from '../../types/chat'
import { ConversationHistoryList } from './ConversationHistoryList'
import { NewThreadProjectDialog } from './NewThreadProjectDialog'
import { ProjectThreadSelector } from './ProjectThreadSelector'
import { SidebarThreadSearch } from './SidebarThreadSearch'
import { getUpdatesSessionSnapshot, subscribeToUpdatesSession } from '../settings/updates/updatesSessionStore'
import type { SettingsItemId } from '../settings/settingsItems'
import {
  ALL_PROJECTS_FILTER_ID,
  ARCHIVED_PROJECT_FILTER_ID,
  CHATS_PROJECT_FILTER_ID,
  buildSidebarProjectOptions,
  resolveSidebarProjectFilter,
} from './sidebarProjectThreads'

interface SidebarPanelProps {
  conversationGroups: ConversationGroupPreview[]
  isLoading?: boolean
  onCreateConversation: (folderId?: string | null) => void
  onCreateFolder: () => Promise<void>
  onCreateWorkspaceFolderFromPath: (folderPath: string) => Promise<void>
  onArchiveConversation: (conversationId: string, isArchived: boolean) => void
  onDeleteConversation: (conversationId: string) => void
  onPinConversation: (conversationId: string, isPinned: boolean) => void
  onDeleteFolder: (folderId: string) => Promise<void>
  onOpenSettings: (itemId?: SettingsItemId) => void
  isMobileLayout?: boolean
  newThreadDialogOpenSignal?: number
  onRenameFolder: (folderId: string, name: string) => Promise<void>
  onSelectConversation: (conversationId: string) => void
  selectedProjectId?: string
  selectedProjectName?: string | null
  onSelectProject?: (projectId: string) => void
}

export function SidebarPanel({
  conversationGroups,
  isLoading = false,
  onCreateFolder,
  onCreateConversation,
  onCreateWorkspaceFolderFromPath,
  onArchiveConversation,
  onDeleteConversation,
  onPinConversation,
  onDeleteFolder,
  onOpenSettings,
  isMobileLayout = false,
  newThreadDialogOpenSignal = 0,
  onRenameFolder,
  onSelectConversation,
  selectedProjectId: controlledSelectedProjectId,
  selectedProjectName = null,
  onSelectProject: controlledOnSelectProject,
}: SidebarPanelProps) {
  const projects = useMemo(() => buildSidebarProjectOptions(conversationGroups), [conversationGroups])
  const hasArchivedConversations = conversationGroups.some(
    (group) => group.folder.id === ARCHIVED_PROJECT_FILTER_ID && group.conversations.length > 0,
  )
  const [internalSelectedProjectId, setInternalSelectedProjectId] = useState(ALL_PROJECTS_FILTER_ID)
  const [searchQuery, setSearchQuery] = useState('')
  const [isNewThreadProjectDialogOpen, setIsNewThreadProjectDialogOpen] = useState(false)
  const previousNewThreadDialogOpenSignalRef = useRef(newThreadDialogOpenSignal)
  const updatesSession = useSyncExternalStore(
    subscribeToUpdatesSession,
    getUpdatesSessionSnapshot,
    getUpdatesSessionSnapshot,
  )
  const updateIsAvailable = updatesSession.result?.updateAvailable === true

  const activeSelectedProjectId = controlledSelectedProjectId ?? internalSelectedProjectId
  const handleSelectProject = useCallback(
    (projectId: string) => {
      if (controlledOnSelectProject) {
        controlledOnSelectProject(projectId)
      } else {
        setInternalSelectedProjectId(projectId)
      }
    },
    [controlledOnSelectProject],
  )

  const resolvedSelectedProjectId = resolveSidebarProjectFilter(
    activeSelectedProjectId,
    projects,
    isLoading,
    hasArchivedConversations,
  )

  useEffect(() => {
    if (isLoading) {
      return
    }
    if (resolvedSelectedProjectId !== activeSelectedProjectId) {
      handleSelectProject(resolvedSelectedProjectId)
    }
  }, [isLoading, activeSelectedProjectId, handleSelectProject, resolvedSelectedProjectId])

  useEffect(() => {
    if (newThreadDialogOpenSignal === previousNewThreadDialogOpenSignalRef.current) {
      return
    }

    previousNewThreadDialogOpenSignalRef.current = newThreadDialogOpenSignal
    setIsNewThreadProjectDialogOpen(true)
  }, [newThreadDialogOpenSignal])

  const actionButtonClassName =
    'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors duration-150 ease-out hover:bg-[var(--sidebar-hover-surface)] hover:text-foreground'

  const handleWorkspaceFolderDragOver = useCallback((event: DragEvent<HTMLElement>) => {
    const hasExternalFiles = Array.from(event.dataTransfer.types).includes('Files')
    if (!hasExternalFiles) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleWorkspaceFolderDrop = useCallback(
    async (event: DragEvent<HTMLElement>) => {
      const folderPaths = getExternalFilePaths(event)
      if (folderPaths.length === 0) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      await onCreateWorkspaceFolderFromPath(folderPaths[0])
    },
    [onCreateWorkspaceFolderFromPath],
  )

  return (
    <aside
      className={isMobileLayout
        ? 'relative flex h-full min-w-0 flex-1 flex-col bg-[var(--sidebar-panel-surface)] pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pl-4 pr-0 pt-3'
        : 'flex h-full min-w-0 flex-1 flex-col bg-[var(--sidebar-panel-surface)] pb-5 pl-4 pr-0 pt-3 md:pl-5 md:pr-0'}
      onDragOver={handleWorkspaceFolderDragOver}
      onDrop={(event) => {
        void handleWorkspaceFolderDrop(event).catch((error) => {
          console.error(error)
        })
      }}
    >
      <div className="pr-6 md:pr-7">
        {!isMobileLayout ? <div className="h-10" aria-hidden="true" /> : null}
        <div className={[
          'flex items-center gap-1',
          !isMobileLayout ? 'mt-4' : '',
        ].join(' ')}>
          <div className="min-w-0 flex-1">
            <SidebarThreadSearch value={searchQuery} onChange={setSearchQuery} />
          </div>
          <Tooltip
            content={
              resolvedSelectedProjectId === ALL_PROJECTS_FILTER_ID
                ? 'Choose a project for a new thread'
                : resolvedSelectedProjectId === CHATS_PROJECT_FILTER_ID
                  ? 'Start new thread in Chats'
                : resolvedSelectedProjectId === ARCHIVED_PROJECT_FILTER_ID
                  ? 'Choose a project for a new thread'
                  : `Start new thread in ${
                    projects.find((project) => project.id === resolvedSelectedProjectId)?.name ?? 'project'
                  }`
            }
            side="right"
          >
            <button
              type="button"
              onClick={() => {
                setIsNewThreadProjectDialogOpen(true)
              }}
              className={actionButtonClassName}
              aria-label="Start new thread"
            >
              <SquarePen size={18} strokeWidth={2.2} />
            </button>
          </Tooltip>
        </div>

        <div className="mt-2 flex items-center justify-between gap-1">
          <ProjectThreadSelector
            cachedSelectedProjectName={selectedProjectName}
            hasArchivedConversations={hasArchivedConversations}
            projects={projects}
            selectedProjectId={resolvedSelectedProjectId}
            onDeleteProject={onDeleteFolder}
            onRenameProject={onRenameFolder}
            onSelectProject={handleSelectProject}
          />
          <div className="flex shrink-0 items-center">
            <Tooltip content="Add folder" side="right">
              <button
                type="button"
                onClick={() => {
                  void onCreateFolder()
                }}
                className={actionButtonClassName}
                aria-label="Open folder picker"
              >
                <FolderPlus size={18} strokeWidth={2.2} />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>

      <div className="scroll-stable mt-2 flex-1 overflow-y-auto pr-6 md:pr-7">
        <ConversationHistoryList
          conversationGroups={conversationGroups}
          isLoading={isLoading}
          searchQuery={searchQuery}
          selectedProjectId={resolvedSelectedProjectId}
           onArchiveConversation={onArchiveConversation}
           onDeleteConversation={onDeleteConversation}
           onPinConversation={onPinConversation}
           onSelectConversation={onSelectConversation}
        />
      </div>

      <div className="pt-4 pr-6 md:pr-7">
        <div className="flex min-h-11 w-full items-center rounded-xl transition-colors duration-200 ease-out hover:bg-[var(--sidebar-hover-surface)]">
          <button
            type="button"
            onClick={() => onOpenSettings()}
            className="flex min-h-11 min-w-0 flex-1 items-center gap-3 px-2 py-3 text-left text-sm font-medium text-foreground"
            aria-label="Open settings"
          >
            <Settings size={18} strokeWidth={2.2} className="shrink-0 text-muted-foreground" />
            <span>Settings</span>
          </button>

          {updateIsAvailable ? (
            <button
              type="button"
              onClick={() => onOpenSettings('settings-item7')}
              className="mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft p-0 text-brand-soft-foreground transition-colors hover:bg-accent-hover"
              aria-label="Open Updates"
            >
              <Download size={16} strokeWidth={2} className="block shrink-0" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>


      {isNewThreadProjectDialogOpen ? (
        <NewThreadProjectDialog
          conversationGroups={conversationGroups}
          projects={projects}
          onAddProject={onCreateFolder}
          onCancel={() => setIsNewThreadProjectDialogOpen(false)}
          onOpenSettings={onOpenSettings}
          onSelectConversation={onSelectConversation}
          onSelectProject={(projectId) => {
            setIsNewThreadProjectDialogOpen(false)
            onCreateConversation(projectId === CHATS_PROJECT_FILTER_ID ? null : projectId)
          }}
          selectedProjectId={resolvedSelectedProjectId}
        />
      ) : null}
    </aside>
  )
}
