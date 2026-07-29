import { ChevronDown, Folder, MoreHorizontal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFloatingMenuPosition } from '../../hooks/useFloatingMenuPosition'
import { RemoveProjectFolderDialog } from './RemoveProjectFolderDialog'
import type { SidebarProjectOption } from './sidebarProjectThreads'
import { ALL_PROJECTS_FILTER_ID, CHATS_PROJECT_FILTER_ID } from './sidebarProjectThreads'

interface ProjectThreadSelectorProps {
  onDeleteProject: (projectId: string) => Promise<void>
  onRenameProject: (projectId: string, name: string) => Promise<void>
  onSelectProject: (projectId: string) => void
  projects: readonly SidebarProjectOption[]
  selectedProjectId: string
}

export function ProjectThreadSelector({
  onDeleteProject,
  onRenameProject,
  onSelectProject,
  projects,
  selectedProjectId,
}: ProjectThreadSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [actionsProject, setActionsProject] = useState<SidebarProjectOption | null>(null)
  const [projectPendingRemoval, setProjectPendingRemoval] = useState<SidebarProjectOption | null>(null)
  const [isRemovingProject, setIsRemovingProject] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const actionsButtonRef = useRef<HTMLButtonElement | null>(null)
  const actionsMenuRef = useRef<HTMLDivElement | null>(null)
  const selectedProject = projects.find((project) => project.id === selectedProjectId)
  const selectedLabel =
    selectedProjectId === CHATS_PROJECT_FILTER_ID ? 'Chats' : (selectedProject?.name ?? 'All projects')
  const menuStyle = useFloatingMenuPosition({
    anchorRef: buttonRef,
    isOpen,
    menuRef,
  })
  const actionsMenuStyle = useFloatingMenuPosition({
    anchorRef: actionsButtonRef,
    isOpen: actionsProject !== null,
    matchAnchorWidth: false,
    menuRef: actionsMenuRef,
  })

  useEffect(() => {
    if (!isOpen && actionsProject === null) {
      return
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target
      if (
        target instanceof Node &&
        !containerRef.current?.contains(target) &&
        !menuRef.current?.contains(target) &&
        !actionsMenuRef.current?.contains(target)
      ) {
        setIsOpen(false)
        setActionsProject(null)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (actionsProject) {
          setActionsProject(null)
          actionsButtonRef.current?.focus()
        } else {
          setIsOpen(false)
          buttonRef.current?.focus()
        }
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [actionsProject, isOpen])

  function selectProject(projectId: string) {
    onSelectProject(projectId)
    setIsOpen(false)
    setActionsProject(null)
  }

  function handleRenameProject(project: SidebarProjectOption) {
    setActionsProject(null)
    const nextName = window.prompt('Rename project folder', project.name)
    if (nextName !== null) {
      void onRenameProject(project.id, nextName)
    }
  }

  async function handleConfirmRemoveProject() {
    if (!projectPendingRemoval) {
      return
    }

    setIsRemovingProject(true)
    try {
      await onDeleteProject(projectPendingRemoval.id)
      setProjectPendingRemoval(null)
      setIsOpen(false)
      setActionsProject(null)
    } finally {
      setIsRemovingProject(false)
    }
  }

  return (
    <>
      <div ref={containerRef} className="relative min-w-0 flex-1">
        <button
          ref={buttonRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          aria-label={`Filter threads by project. Current selection: ${selectedLabel}`}
          onClick={() => setIsOpen((currentValue) => !currentValue)}
          className="flex h-10 w-full min-w-0 items-center gap-2 rounded-xl px-2 text-left text-foreground transition-colors hover:bg-[var(--sidebar-hover-surface)]"
        >
          <Folder size={17} strokeWidth={2} className="shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{selectedLabel}</span>
          <ChevronDown
            size={16}
            strokeWidth={2.2}
            className={[
              'shrink-0 text-muted-foreground transition-transform duration-150',
              isOpen ? 'rotate-180' : '',
            ].join(' ')}
          />
        </button>
      </div>

      {isOpen
        ? createPortal(
            <div
              ref={menuRef}
              data-floating-menu-root="true"
              role="menu"
              aria-label="Projects"
              className="fixed z-[1500] overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-soft"
              style={menuStyle}
            >
              <button
                type="button"
                role="menuitemradio"
                aria-checked={selectedProjectId === ALL_PROJECTS_FILTER_ID}
                onClick={() => selectProject(ALL_PROJECTS_FILTER_ID)}
                className="flex h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm text-foreground transition-colors hover:bg-[var(--dropdown-option-hover-surface)]"
              >
                <Folder size={16} strokeWidth={2} className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-medium">All projects</span>
              </button>

              <button
                type="button"
                role="menuitemradio"
                aria-checked={selectedProjectId === CHATS_PROJECT_FILTER_ID}
                onClick={() => selectProject(CHATS_PROJECT_FILTER_ID)}
                className="flex h-10 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm text-foreground transition-colors hover:bg-[var(--dropdown-option-hover-surface)]"
              >
                <Folder size={16} strokeWidth={2} className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-medium">Chats</span>
              </button>

              {projects.length > 0 ? <div role="separator" className="mx-2 my-1 h-px bg-border" /> : null}

              {projects.map((project) => (
                <div key={project.id} role="none" className="group/project flex h-10 items-center rounded-lg transition-colors hover:bg-[var(--dropdown-option-hover-surface)]">
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={selectedProjectId === project.id}
                    onClick={() => selectProject(project.id)}
                    className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 text-left text-sm text-foreground"
                  >
                    <Folder size={16} strokeWidth={2} className="shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-medium">{project.name}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    aria-label={`Project actions for ${project.name}`}
                    aria-haspopup="menu"
                    aria-expanded={actionsProject?.id === project.id}
                    onClick={(event) => {
                      actionsButtonRef.current = event.currentTarget
                      setActionsProject((currentValue) => (currentValue?.id === project.id ? null : project))
                    }}
                    className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[var(--dropdown-option-active-surface)] hover:text-foreground"
                  >
                    <MoreHorizontal size={16} strokeWidth={2.1} />
                  </button>
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}

      {actionsProject
        ? createPortal(
            <div
              ref={actionsMenuRef}
              data-floating-menu-root="true"
              role="menu"
              aria-label={`Actions for ${actionsProject.name}`}
              className="fixed z-[1600] min-w-[180px] rounded-xl border border-border bg-surface p-1 shadow-soft"
              style={actionsMenuStyle}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => handleRenameProject(actionsProject)}
                className="flex h-10 w-full items-center rounded-lg px-2.5 text-left text-sm text-foreground transition-colors hover:bg-[var(--dropdown-option-hover-surface)]"
              >
                Rename project
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setProjectPendingRemoval(actionsProject)
                  setActionsProject(null)
                }}
                className="flex h-10 w-full items-center rounded-lg px-2.5 text-left text-sm text-danger-foreground transition-colors hover:bg-danger-surface"
              >
                Remove project
              </button>
            </div>,
            document.body,
          )
        : null}

      {projectPendingRemoval ? (
        <RemoveProjectFolderDialog
          folderName={projectPendingRemoval.name}
          isBusy={isRemovingProject}
          onCancel={() => {
            if (!isRemovingProject) {
              setProjectPendingRemoval(null)
            }
          }}
          onConfirm={() => {
            void handleConfirmRemoveProject()
          }}
        />
      ) : null}
    </>
  )
}
