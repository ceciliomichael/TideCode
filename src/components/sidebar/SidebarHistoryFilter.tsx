import { Check, ListFilter } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFloatingMenuPosition } from '../../hooks/useFloatingMenuPosition'
import { Tooltip } from '../Tooltip'
import { getDropdownOptionStateClassName } from '../ui/dropdownOptionStyles'
import {
  ALL_PROJECTS_FILTER_ID,
  ARCHIVED_PROJECT_FILTER_ID,
  CHATS_PROJECT_FILTER_ID,
} from './sidebarProjectThreads'

interface SidebarHistoryFilterProps {
  hasArchivedConversations: boolean
  onSelectProject: (projectId: string) => void
  selectedProjectId: string
}

const historyFilters = [
  {
    id: ALL_PROJECTS_FILTER_ID,
    label: 'All projects',
  },
  {
    id: CHATS_PROJECT_FILTER_ID,
    label: 'Chats',
  },
] as const

export function SidebarHistoryFilter({
  hasArchivedConversations,
  onSelectProject,
  selectedProjectId,
}: SidebarHistoryFilterProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedFilterId, setHighlightedFilterId] = useState(selectedProjectId)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const menuStyle = useFloatingMenuPosition({
    anchorRef: buttonRef,
    isOpen,
    matchAnchorWidth: false,
    menuRef,
  })

  useEffect(() => {
    if (isOpen) {
      setHighlightedFilterId(selectedProjectId)
    }
  }, [isOpen, selectedProjectId])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target
      if (
        target instanceof Node &&
        !containerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setIsOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') {
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
  }, [isOpen])

  function selectFilter(filterId: string) {
    onSelectProject(filterId)
    setIsOpen(false)
  }

  const filters = hasArchivedConversations
    ? [
        ...historyFilters,
        {
          id: ARCHIVED_PROJECT_FILTER_ID,
          label: 'Archived',
        },
      ]
    : historyFilters

  return (
    <div ref={containerRef} className="relative shrink-0">
      <Tooltip content="Filter chats" side="top">
        <button
          ref={buttonRef}
          type="button"
          aria-label="Filter chats"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          onClick={() => setIsOpen((currentValue) => !currentValue)}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors duration-150 ease-out hover:bg-[var(--sidebar-hover-surface)] hover:text-foreground"
        >
          <ListFilter size={18} strokeWidth={2.2} />
        </button>
      </Tooltip>

      {isOpen
        ? createPortal(
            <div
              ref={menuRef}
              data-floating-menu-root="true"
              role="menu"
              aria-label="Filter chats"
              onMouseLeave={() => setHighlightedFilterId(selectedProjectId)}
              className="fixed z-[1700] min-w-[9rem] space-y-0.5 overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-soft"
              style={menuStyle}
            >
              {filters.map(({ id, label }) => {
                const isSelected = selectedProjectId === id
                const isHighlighted = highlightedFilterId === id

                return (
                  <button
                    key={id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isSelected}
                    onMouseEnter={() => setHighlightedFilterId(id)}
                    onClick={() => selectFilter(id)}
                    className={[
                      'flex h-10 w-full items-center justify-between gap-2 rounded-lg px-2.5 text-left text-sm transition-[background-color,color,box-shadow]',
                      getDropdownOptionStateClassName(isHighlighted),
                    ].join(' ')}
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
                    {isSelected ? <Check size={16} strokeWidth={2.2} className="shrink-0" /> : null}
                  </button>
                )
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
