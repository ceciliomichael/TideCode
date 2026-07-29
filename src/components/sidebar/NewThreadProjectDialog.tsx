import {
  ChevronRight,
  Folder,
  FolderPlus,
  MessageSquareText,
  Search,
  Settings,
  SquarePen,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { ConversationGroupPreview } from '../../types/chat'
import {
  ALL_PROJECTS_FILTER_ID,
  CHATS_PROJECT_FILTER_ID,
  UNASSIGNED_WORKSPACE_NAME,
  buildSidebarThreadRows,
  type SidebarProjectOption,
  type SidebarThreadRow,
} from './sidebarProjectThreads'

type PaletteItem =
  | { kind: 'project'; project: SidebarProjectOption }
  | { kind: 'choose-project' }
  | { kind: 'add-project' }
  | { kind: 'settings' }
  | { kind: 'conversation'; row: SidebarThreadRow }

interface NewThreadProjectDialogProps {
  conversationGroups: ConversationGroupPreview[]
  onAddProject: () => Promise<void>
  onCancel: () => void
  onOpenSettings: () => void
  onSelectConversation: (conversationId: string) => void
  onSelectProject: (projectId: string) => void
  projects: readonly SidebarProjectOption[]
  selectedProjectId: string
}

function matchesSearch(value: string, normalizedQuery: string) {
  return normalizedQuery.length === 0 || value.toLocaleLowerCase().includes(normalizedQuery)
}

export function NewThreadProjectDialog({
  conversationGroups,
  onAddProject,
  onCancel,
  onOpenSettings,
  onSelectConversation,
  onSelectProject,
  projects,
  selectedProjectId,
}: NewThreadProjectDialogProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [page, setPage] = useState<'root' | 'projects'>('root')
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase()
  const allThreadRows = useMemo(
    () => buildSidebarThreadRows(conversationGroups, ALL_PROJECTS_FILTER_ID),
    [conversationGroups],
  )
  const recentThreads = useMemo(
    () => buildSidebarThreadRows(conversationGroups, ALL_PROJECTS_FILTER_ID, searchQuery).slice(0, 10),
    [conversationGroups, searchQuery],
  )
  const allProjectOptions = useMemo<SidebarProjectOption[]>(
    () => [
      {
        id: CHATS_PROJECT_FILTER_ID,
        name: UNASSIGNED_WORKSPACE_NAME,
        conversationCount: conversationGroups.reduce(
          (acc, group) => acc + group.conversations.filter((c) => c.folderId === null).length,
          0,
        ),
      },
      ...projects,
    ],
    [conversationGroups, projects],
  )
  const latestProject = useMemo(() => {
    if (selectedProjectId !== ALL_PROJECTS_FILTER_ID) {
      return allProjectOptions.find((project) => project.id === selectedProjectId) ?? allProjectOptions[0] ?? null
    }
    const latestFolderId = allThreadRows[0]?.conversation.folderId ?? null
    const targetId = latestFolderId === null ? CHATS_PROJECT_FILTER_ID : latestFolderId
    return allProjectOptions.find((project) => project.id === targetId) ?? allProjectOptions[0] ?? null
  }, [allThreadRows, allProjectOptions, selectedProjectId])
  const matchingProjects = useMemo(
    () =>
      allProjectOptions.filter(
        (project) =>
          matchesSearch(project.name, normalizedQuery) ||
          matchesSearch(`new thread in ${project.name}`, normalizedQuery),
      ),
    [allProjectOptions, normalizedQuery],
  )
  const showLatestProject =
    latestProject !== null && matchesSearch(`new thread in ${latestProject.name}`, normalizedQuery)
  const showChooseProject = matchesSearch('new thread in choose project', normalizedQuery)
  const showAddProject = matchesSearch('add project', normalizedQuery)
  const showSettings = matchesSearch('open settings', normalizedQuery)
  const actionItems = useMemo<PaletteItem[]>(
    () => [
      ...(showLatestProject && latestProject ? [{ kind: 'project' as const, project: latestProject }] : []),
      ...(showChooseProject ? [{ kind: 'choose-project' as const }] : []),
      ...(showAddProject ? [{ kind: 'add-project' as const }] : []),
      ...(showSettings ? [{ kind: 'settings' as const }] : []),
    ],
    [latestProject, showAddProject, showChooseProject, showLatestProject, showSettings],
  )
  const projectItems = useMemo<PaletteItem[]>(
    () => matchingProjects.map((project) => ({ kind: 'project' as const, project })),
    [matchingProjects],
  )
  const recentThreadItems = useMemo<PaletteItem[]>(
    () => recentThreads.map((row) => ({ kind: 'conversation' as const, row })),
    [recentThreads],
  )
  const paletteItems = useMemo(
    () => (page === 'projects' ? projectItems : [...actionItems, ...recentThreadItems]),
    [actionItems, page, projectItems, recentThreadItems],
  )
  const recentThreadsStartIndex = actionItems.length

  useEffect(() => {
    searchInputRef.current?.focus()
  }, [])

  useEffect(() => {
    setHighlightedIndex((currentValue) => Math.min(currentValue, Math.max(paletteItems.length - 1, 0)))
  }, [paletteItems.length])

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-palette-index="${highlightedIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex])

  useEffect(() => {
    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        if (page === 'projects') {
          setPage('root')
          setSearchQuery('')
          setHighlightedIndex(Math.max(actionItems.findIndex((item) => item.kind === 'choose-project'), 0))
        } else {
          onCancel()
        }
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [actionItems, onCancel, page])

  function executeItem(item: PaletteItem | undefined) {
    if (!item) {
      return
    }

    if (item.kind === 'project') {
      onSelectProject(item.project.id)
      return
    }

    if (item.kind === 'choose-project') {
      setPage('projects')
      setSearchQuery('')
      setHighlightedIndex(0)
      return
    }

    if (item.kind === 'add-project') {
      onCancel()
      void onAddProject()
      return
    }

    if (item.kind === 'settings') {
      onCancel()
      onOpenSettings()
      return
    }

    onCancel()
    onSelectConversation(item.row.conversation.id)
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlightedIndex((currentValue) => Math.min(currentValue + 1, Math.max(paletteItems.length - 1, 0)))
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightedIndex((currentValue) => Math.max(currentValue - 1, 0))
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      executeItem(paletteItems[highlightedIndex])
    }
  }

  function getActionPresentation(item: PaletteItem) {
    if (item.kind === 'project') {
      return {
        icon: <SquarePen size={18} strokeWidth={2} />,
        label: (
          <>
            New thread in <strong className="font-semibold">{item.project.name}</strong>
          </>
        ),
        trailing: null,
      }
    }

    if (item.kind === 'choose-project') {
      return {
        icon: <SquarePen size={18} strokeWidth={2} />,
        label: 'New thread in…',
        trailing: <ChevronRight size={17} strokeWidth={2.1} />,
      }
    }

    if (item.kind === 'add-project') {
      return {
        icon: <FolderPlus size={18} strokeWidth={2} />,
        label: 'Add project',
        trailing: null,
      }
    }

    return {
      icon: <Settings size={18} strokeWidth={2} />,
      label: 'Open settings',
      trailing: null,
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[2100] flex items-start justify-center bg-black/60 px-5 pt-[8vh]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel()
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Commands, projects, and threads"
        className="flex max-h-[60vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-soft"
      >
        <div className="relative shrink-0 border-b border-border">
          <Search
            size={19}
            strokeWidth={2}
            className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value)
              setHighlightedIndex(0)
            }}
            onKeyDown={handleSearchKeyDown}
            placeholder={page === 'projects' ? 'Search projects...' : 'Search commands, projects, and threads...'}
            className="h-12 w-full bg-transparent pl-14 pr-5 text-[15px] text-foreground outline-none placeholder:text-subtle-foreground"
          />
        </div>


        <div ref={listRef} className="min-h-0 max-h-[calc(60vh-6rem)] overflow-y-auto px-2 py-3">
          {page === 'root' && actionItems.length > 0 ? (
            <section aria-labelledby="new-thread-actions-label">
              <h2
                id="new-thread-actions-label"
                className="px-3 pb-1.5 text-xs font-semibold uppercase tracking-wide text-subtle-foreground"
              >
                Actions
              </h2>
              {actionItems.map((item, index) => {
                const presentation = getActionPresentation(item)

                return (
                  <button
                    key={item.kind === 'project' ? `latest-${item.project.id}` : item.kind}
                    type="button"
                    data-palette-index={index}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onClick={() => executeItem(item)}
                    className={[
                      'flex h-12 w-full items-center gap-3 rounded-lg px-3 text-left text-[15px] transition-colors',
                      highlightedIndex === index
                        ? 'bg-[var(--dropdown-option-active-surface)] text-foreground'
                        : 'text-foreground hover:bg-[var(--dropdown-option-hover-surface)]',
                    ].join(' ')}
                  >
                    <span className="shrink-0 text-muted-foreground">{presentation.icon}</span>
                    <span className="min-w-0 flex-1 truncate">{presentation.label}</span>
                    {presentation.trailing ? (
                      <span className="shrink-0 text-muted-foreground">{presentation.trailing}</span>
                    ) : null}
                  </button>
                )
              })}
            </section>
          ) : null}

          {page === 'projects' ? (
            <section aria-labelledby="new-thread-projects-label">
              <h2
                id="new-thread-projects-label"
                className="px-3 pb-1.5 text-xs font-semibold uppercase tracking-wide text-subtle-foreground"
              >
                Projects
              </h2>
              {projectItems.length > 0 ? (
                projectItems.map((item, index) => {
                  if (item.kind !== 'project') {
                    return null
                  }

                  const paletteIndex = index
                  return (
                    <button
                      key={item.project.id}
                      type="button"
                      data-palette-index={paletteIndex}
                      onMouseEnter={() => setHighlightedIndex(paletteIndex)}
                      onClick={() => executeItem(item)}
                      className={[
                        'flex h-12 w-full items-center gap-3 rounded-lg px-3 text-left transition-colors',
                        highlightedIndex === paletteIndex
                          ? 'bg-[var(--dropdown-option-active-surface)] text-foreground'
                          : 'text-foreground hover:bg-[var(--dropdown-option-hover-surface)]',
                      ].join(' ')}
                    >
                      <Folder size={18} strokeWidth={2} className="shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{item.project.name}</span>
                    </button>
                  )
                })
              ) : (
                <p className="px-3 py-4 text-sm text-subtle-foreground">No matching projects.</p>
              )}
            </section>
          ) : null}

          {page === 'root' && recentThreads.length > 0 ? (
            <section aria-labelledby="recent-threads-label" className="mt-5">
              <h2
                id="recent-threads-label"
                className="px-3 pb-1.5 text-xs font-semibold uppercase tracking-wide text-subtle-foreground"
              >
                Recent threads
              </h2>
              {recentThreads.map((row, index) => {
                const paletteIndex = recentThreadsStartIndex + index

                return (
                  <button
                    key={row.conversation.id}
                    type="button"
                    data-palette-index={paletteIndex}
                    onMouseEnter={() => setHighlightedIndex(paletteIndex)}
                    onClick={() => executeItem({ kind: 'conversation', row })}
                    className={[
                      'flex min-h-14 w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors',
                      highlightedIndex === paletteIndex
                        ? 'bg-[var(--dropdown-option-active-surface)] text-foreground'
                        : 'text-foreground hover:bg-[var(--dropdown-option-hover-surface)]',
                    ].join(' ')}
                  >
                    <MessageSquareText size={18} strokeWidth={2} className="shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">{row.conversation.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-subtle-foreground">{row.workspaceName}</span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-subtle-foreground">
                      {row.conversation.updatedAtLabel}
                    </span>
                  </button>
                )
              })}
            </section>
          ) : null}

          {page === 'root' && paletteItems.length === 0 ? (
            <div className="flex min-h-48 items-center justify-center px-6 text-center">
              <div>
                <p className="text-sm font-medium text-foreground">No matching commands or threads</p>
                <p className="mt-1 text-xs text-subtle-foreground">Try a different search.</p>
              </div>
            </div>
          ) : null}
        </div>

        <footer className="flex h-12 shrink-0 items-center gap-4 border-t border-border px-4 text-xs text-subtle-foreground">
          <span>
            <kbd className="rounded-md bg-surface-muted px-1.5 py-1 text-foreground">↑</kbd>{' '}
            <kbd className="rounded-md bg-surface-muted px-1.5 py-1 text-foreground">↓</kbd> Navigate
          </span>
          <span>
            <kbd className="rounded-md bg-surface-muted px-1.5 py-1 text-foreground">Enter</kbd> Select
          </span>
          <span>
            <kbd className="rounded-md bg-surface-muted px-1.5 py-1 text-foreground">Esc</kbd> Close
          </span>
        </footer>
      </section>
    </div>,
    document.body,
  )
}
