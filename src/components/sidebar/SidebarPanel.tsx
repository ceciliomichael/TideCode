import { FolderPlus, Settings } from 'lucide-react'
import { useCallback, type DragEvent } from 'react'
import { getExternalFilePaths } from '../../lib/externalFileDrop'
import { Tooltip } from '../Tooltip'
import type { ConversationGroupPreview, ReorderConversationFolderInput } from '../../types/chat'
import { ConversationHistoryList } from './ConversationHistoryList'

interface SidebarPanelProps {
  conversationGroups: ConversationGroupPreview[]
  onCreateConversation: (folderId?: string | null) => void
  onCreateFolder: () => Promise<void>
  onCreateWorkspaceFolderFromPath: (folderPath: string) => Promise<void>
  onDeleteConversation: (conversationId: string) => void
  onPinConversation: (conversationId: string, isPinned: boolean) => void
  onDeleteFolder: (folderId: string) => Promise<void>
  onReorderFolder: (input: ReorderConversationFolderInput) => Promise<void>
  onOpenSettings: () => void
  onRenameFolder: (folderId: string, name: string) => Promise<void>
  onSelectConversation: (conversationId: string) => void
  onSelectFolder: (folderId: string | null) => void
}

export function SidebarPanel({
  conversationGroups,
  onCreateFolder,
  onCreateConversation,
  onCreateWorkspaceFolderFromPath,
  onDeleteConversation,
  onPinConversation,
  onDeleteFolder,
  onReorderFolder,
  onOpenSettings,
  onRenameFolder,
  onSelectConversation,
  onSelectFolder,
}: SidebarPanelProps) {
  const actionButtonClassName =
    'flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-all duration-150 ease-out hover:scale-110 hover:text-foreground'
  const footerButtonClassName =
    'flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-3 text-left text-sm font-medium text-foreground transition-colors duration-200 ease-out hover:bg-[var(--sidebar-hover-surface)]'

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
      className="flex h-full min-w-0 flex-1 flex-col bg-[var(--sidebar-panel-surface)] pb-5 pl-4 pr-0 pt-3 md:pl-5 md:pr-0"
      onDragOver={handleWorkspaceFolderDragOver}
      onDrop={(event) => {
        void handleWorkspaceFolderDrop(event).catch((error) => {
          console.error(error)
        })
      }}
    >
      <div className="pb-4 pr-6 md:pr-7">
        <div className="h-10" aria-hidden="true" />

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1 pl-2">
            <p className="truncate whitespace-nowrap text-sm font-semibold text-foreground">Threads</p>
          </div>
          <div className="flex items-center gap-2">
            <Tooltip content="Add folder" side="left">
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
          onCreateConversation={onCreateConversation}
          onDeleteConversation={onDeleteConversation}
          onPinConversation={onPinConversation}
          onDeleteFolder={onDeleteFolder}
          onReorderFolder={onReorderFolder}
          onRenameFolder={onRenameFolder}
          onSelectConversation={onSelectConversation}
          onSelectFolder={onSelectFolder}
        />
      </div>

      <div className="pt-4 pr-6 md:pr-7">
        <button
          type="button"
          onClick={onOpenSettings}
          className={footerButtonClassName}
          aria-label="Open settings"
        >
          <Settings size={18} strokeWidth={2.2} className="shrink-0 text-muted-foreground" />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  )
}
