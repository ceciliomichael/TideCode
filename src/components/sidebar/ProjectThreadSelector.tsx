import { Check, ChevronDown, Folder, MoreHorizontal, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFloatingMenuPosition } from '../../hooks/useFloatingMenuPosition'
import { getDropdownOptionStateClassName } from '../ui/dropdownOptionStyles'
import { RemoveProjectFolderDialog } from './RemoveProjectFolderDialog'
import type { SidebarProjectOption } from './sidebarProjectThreads'
import {
  ALL_PROJECTS_FILTER_ID,
  ARCHIVED_PROJECT_FILTER_ID,
  CHATS_PROJECT_FILTER_ID,
} from './sidebarProjectThreads'

interface ProjectThreadSelectorProps {
  cachedSelectedProjectName?: string | null
  onDeleteProject: (projectId: string) => Promise<void>
  onRenameProject: (projectId: string, name: string) => Promise<void>
  onSelectProject: (projectId: string) => void
  projects: readonly SidebarProjectOption[]
  selectedProjectId: string
}

function normalizeSearch(value: string) {
  return value.trim().toLowerCase()
}

export function ProjectThreadSelector({
  cachedSelectedProjectName = null,
  onDeleteProject,
  onRenameProject,
  onSelectProject,
  projects,
  selectedProjectId,
}: ProjectThreadSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const [highlightedProjectId, setHighlightedProjectId] = useState(selectedProjectId)
  const [actionsProject, setActionsProject] = useState<SidebarProjectOption | null>(null)
  const [projectPendingRemoval, setProjectPendingRemoval] = useState<SidebarProjectOption | null>(null)
  const [isRemovingProject, setIsRemovingProject] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const actionsButtonRef = useRef<HTMLButtonElement | null>(null)
  const actionsMenuRef = useRef<HTMLDivElement | null>(null)
  const selectedProject = projects.find((project) => project.id === selectedProjectId)
  const isHistoryFilterSelected =
    selectedProjectId === ALL_PROJECTS_FILTER_ID ||
    selectedProjectId === CHATS_PROJECT_FILTER_ID ||
    selectedProjectId === ARCHIVED_PROJECT_FILTER_ID
  const cachedProjectName = cachedSelectedProjectName?.trim()
  const selectedLabel =
    selectedProject?.name ?? (isHistoryFilterSelected ? 'Projects' : cachedProjectName || 'Projects')
  const normalizedSearch = normalizeSearch(searchValue)
  const filteredProjects = useMemo(() => {
    if (normalizedSearch.length === 0) {
      return projects
    }

    return projects.filter((project) => project.name.toLowerCase().includes(normalizedSearch))
  }, [normalizedSearch, projects])
  const menuStyle = useFloatingMenuPosition({
    anchorRef: buttonRef,
    isOpen,
    matchAnchorWidth: false,
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
      if (event.key !== 'Escape') {
        return
      }

      if (actionsProject) {
        setActionsProject(null)
        actionsButtonRef.current?.focus()
        return
      }

      setIsOpen(false)
      buttonRef.current?.focus()
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [actionsProject, isOpen])

  useEffect(() => {
    if (isOpen) {
      searchInputRef.current?.focus()
    }
  }, [isOpen])

  useEffect(() => {
    if (isOpen) {
      setHighlightedProjectId(selectedProjectId)
    }
  }, [isOpen, selectedProjectId])

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
          aria-label={`Choose project. Current selection: ${selectedLabel}`}
          onClick={() => setIsOpen((currentValue) => !currentValue)}
          className="flex h-10 w-full min-w-0 items-center gap-2 rounded-xl pl-3 pr-2 text-left text-foreground transition-colors hover:bg-[var(--sidebar-hover-surface)]"
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
              className="fixed z-[1500] w-[min(18rem,calc(100vw-1rem))] min-w-[10rem] overflow-hidden rounded-xl border border-border bg-surface shadow-soft"
              style={menuStyle}
            >
              <div className="border-b border-border px-2 py-2">
                <div className="relative min-w-0">
                  <Search
                    size={15}
                    className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchValue}
                    onChange={(event) => setSearchValue(event.target.value)}
                    placeholder="Search projects..."
                    aria-label="Search projects"
                    className="h-9 w-full rounded-lg border border-border bg-surface-muted pl-8 pr-2.5 text-sm text-foreground outline-none placeholder:text-subtle-foreground"
                  />
                </div>
              </div>

              <div
                onMouseLeave={() => setHighlightedProjectId(selectedProjectId)}
                className="max-h-56 space-y-0.5 overflow-y-auto p-1"
              >
                {filteredProjects.length > 0 ? (
                  filteredProjects.map((project) => {
                    const isSelected = project.id === selectedProjectId
                    const isHighlighted = project.id === highlightedProjectId

                    return (
                      <div
                        key={project.id}
                        role="none"
                        onMouseEnter={() => setHighlightedProjectId(project.id)}
                        className={[
                          'group/project flex min-h-10 items-center rounded-xl transition-[background-color,color,box-shadow]',
                          getDropdownOptionStateClassName(isSelected, isHighlighted),
                        ].join(' ')}
                      >
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={isSelected}
                          onMouseEnter={() => setHighlightedProjectId(project.id)}
                          onClick={() => selectProject(project.id)}
                          className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-xl px-2.5 py-2 text-left text-foreground"
                        >
                          <Folder size={16} strokeWidth={2} className="shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">{project.name}</span>
                          {isSelected ? (
                            <Check size={16} strokeWidth={2.2} className="shrink-0 text-foreground" />
                          ) : null}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          aria-label={`Project actions for ${project.name}`}
                          aria-haspopup="menu"
                          aria-expanded={actionsProject?.id === project.id}
                          onClick={(event) => {
                            actionsButtonRef.current = event.currentTarget
                            setActionsProject((currentValue) =>
                              currentValue?.id === project.id ? null : project,
                            )
                          }}
                          className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:rounded-xl hover:bg-[var(--dropdown-option-active-surface)] hover:text-foreground"
                        >
                          <MoreHorizontal size={16} strokeWidth={2.1} />
                        </button>
                      </div>
                    )
                  })
                ) : (
                  <p className="px-2.5 py-2 text-sm text-muted-foreground">No projects found.</p>
                )}
              </div>
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
