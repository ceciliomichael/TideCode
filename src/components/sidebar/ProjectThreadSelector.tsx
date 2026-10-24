import { Check, ChevronDown, Folder, MoreHorizontal, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFloatingMenuPosition } from '../../hooks/useFloatingMenuPosition'
import { Tooltip } from '../Tooltip'
import { RemoveProjectFolderDialog } from './RemoveProjectFolderDialog'
import type { SidebarProjectOption } from './sidebarProjectThreads'
import { CHATS_PROJECT_FILTER_ID, resolveSidebarProjectLabel } from './sidebarProjectThreads'

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
  const [agentContextsPath] = useState<string | null>(() => {
    try {
      const draftPath = window.tidecodeHistory?.getDraftAgentContextPathSync?.()
      return draftPath?.replace(/[\\/][^\\/]+$/, '') ?? null
    } catch {
      return null
    }
  })
  const [isOpen, setIsOpen] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const [highlightedProjectId, setHighlightedProjectId] = useState<string | null>(selectedProjectId)
  const [actionsProject, setActionsProject] = useState<SidebarProjectOption | null>(null)
  const [actionsMenuPosition, setActionsMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const [projectPendingRemoval, setProjectPendingRemoval] = useState<SidebarProjectOption | null>(null)
  const [isRemovingProject, setIsRemovingProject] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const actionsButtonRef = useRef<HTMLButtonElement | null>(null)
  const actionsMenuRef = useRef<HTMLDivElement | null>(null)
  const selectedLabel = resolveSidebarProjectLabel(
    selectedProjectId,
    projects,
    cachedSelectedProjectName,
  )
  const normalizedSearch = normalizeSearch(searchValue)
  const filteredProjects = useMemo(() => {
    const options: readonly SidebarProjectOption[] = [
      {
        id: CHATS_PROJECT_FILTER_ID,
        name: 'Chats',
        path: agentContextsPath,
        conversationCount: 0,
      },
      ...projects,
    ]

    if (normalizedSearch.length === 0) {
      return options
    }

    return options.filter((project) => project.name.toLowerCase().includes(normalizedSearch))
  }, [agentContextsPath, normalizedSearch, projects])
  const menuStyle = useFloatingMenuPosition({
    anchorRef: buttonRef,
    isOpen,
    horizontalAlignment: 'center',
    matchAnchorWidth: false,
    menuRef,
  })
  const actionsMenuStyle = useFloatingMenuPosition({
    anchorRef: actionsButtonRef,
    anchorPoint: actionsMenuPosition,
    isOpen: actionsProject !== null,
    matchAnchorWidth: false,
    menuRef: actionsMenuRef,
    positionKey: actionsProject?.id ?? null,
    preferredHorizontalPlacement: 'right',
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
              className="fixed z-[1500] w-[min(20rem,calc(100vw-1rem))] min-w-[12rem] overflow-hidden rounded-xl border border-border bg-surface shadow-soft"
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
                onMouseLeave={() => {
                  if (actionsProject === null) {
                    setHighlightedProjectId(selectedProjectId)
                  }
                }}
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
                        className={[
                          'group/project flex min-h-14 items-center rounded-xl transition-[background-color,color,box-shadow]',
                          isHighlighted
                            ? 'bg-[var(--dropdown-option-active-surface)] text-foreground shadow-sm'
                            : 'text-foreground',
                        ].join(' ')}
                      >
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={isSelected}
                          onMouseEnter={() => setHighlightedProjectId(project.id)}
                          onClick={() => selectProject(project.id)}
                          className="flex min-h-14 min-w-0 flex-1 items-start gap-2 rounded-xl px-2.5 py-2 text-left text-foreground"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] leading-5">{project.name}</span>
                            {(project.description ?? project.path) ? (
                              <span
                                title={
                                  project.id === CHATS_PROJECT_FILTER_ID
                                    ? undefined
                                    : project.description ?? project.path ?? undefined
                                }
                                className="mt-0.5 block truncate text-[11px] font-medium text-muted-foreground"
                              >
                                {project.description ?? project.path}
                              </span>
                            ) : null}
                          </span>
                        </button>
                        {isSelected ? (
                          <span className="mr-1 flex h-9 w-9 shrink-0 items-start justify-center pt-0.5 md:group-hover/project:hidden">
                            <Check
                              size={16}
                              strokeWidth={2.2}
                              aria-hidden="true"
                              className="shrink-0 text-foreground"
                            />
                          </span>
                        ) : null}
                        {project.id !== CHATS_PROJECT_FILTER_ID ? (
                          <Tooltip
                            content="Project actions"
                            hideWhenTriggerExpanded
                            panelClassName="!z-[1800]"
                            side="right"
                          >
                            <button
                              type="button"
                              role="menuitem"
                              aria-label={`Project actions for ${project.name}`}
                              aria-haspopup="menu"
                              aria-expanded={actionsProject?.id === project.id}
                              onMouseEnter={() => setHighlightedProjectId(project.id)}
                              onClick={(event) => {
                                actionsButtonRef.current = event.currentTarget
                                setActionsMenuPosition(
                                  event.detail > 0
                                    ? { x: event.clientX, y: event.clientY }
                                    : null,
                                )
                                setActionsProject((currentValue) =>
                                  currentValue?.id === project.id ? null : project,
                                )
                              }}
                              className="mr-1 flex h-9 w-9 shrink-0 origin-center transform-gpu items-center justify-center rounded-full text-subtle-foreground transition-[color,opacity,transform] duration-150 ease-out hover:scale-110 hover:text-foreground md:hidden md:group-hover/project:flex"
                            >
                              <MoreHorizontal size={16} strokeWidth={2.1} />
                            </button>
                          </Tooltip>
                        ) : null}
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
              className="fixed z-[1600] min-w-[180px] overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-soft"
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
