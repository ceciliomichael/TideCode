import { File, Folder, ListTodo, Wand2 } from 'lucide-react'
import { createPortal } from 'react-dom'
import type { CSSProperties, RefObject } from 'react'
import { resolveFileIconConfig } from '../../lib/fileIconResolver'

export type ChatMentionMenuType = 'file' | 'folder' | 'skill' | 'kanban'

export interface ChatMentionMenuItem {
  description: string
  kind: ChatMentionMenuType
  label: string
  relativePath: string
}

interface ChatMentionMenuProps {
  anchorRef: RefObject<HTMLElement>
  isOpen: boolean
  loading: boolean
  menuRef: RefObject<HTMLDivElement>
  menuStyle: CSSProperties
  onItemMouseDown?: () => void
  onSelect: (item: ChatMentionMenuItem) => void
  onSelectCategory: (kind: ChatMentionMenuType) => void
  onHighlightIndex: (index: number) => void
  onResetHighlight: () => void
  results: readonly ChatMentionMenuItem[]
  highlightedIndex: number
  selectedMenuType: ChatMentionMenuType | null
  searchQuery: string
  workspaceRootAvailable: boolean
}

const ROOT_OPTIONS: readonly {
  description: string
  icon: typeof File
  kind: ChatMentionMenuType
  label: string
}[] = [
  {
    description: 'Search for files',
    icon: File,
    kind: 'file',
    label: 'File',
  },
  {
    description: 'Search for folders',
    icon: Folder,
    kind: 'folder',
    label: 'Folder',
  },
  {
    description: 'Search for skills',
    icon: Wand2,
    kind: 'skill',
    label: 'Skills',
  },
  {
    description: 'Search Kanban items',
    icon: ListTodo,
    kind: 'kanban',
    label: 'Kanban',
  },
]

export function ChatMentionMenu({
  anchorRef,
  isOpen,
  loading,
  menuRef,
  menuStyle,
  onItemMouseDown,
  onSelect,
  onSelectCategory,
  onHighlightIndex,
  onResetHighlight,
  results,
  highlightedIndex,
  selectedMenuType,
  searchQuery,
  workspaceRootAvailable,
}: ChatMentionMenuProps) {
  if (!isOpen) {
    return null
  }

  const hasSearchQuery = searchQuery.trim().length > 0
  const content =
    selectedMenuType === null && !hasSearchQuery ? (
      <div
        ref={menuRef}
        role="listbox"
        aria-label="File mentions"
        data-floating-menu-root="true"
        className="fixed z-40 w-[min(26rem,calc(100vw-1rem))] overflow-hidden rounded-[22px] border border-border bg-surface shadow-[0_10px_30px_rgba(15,23,42,0.08)]"
        style={menuStyle}
      >
        <div onMouseLeave={onResetHighlight}>
          <div>
            {!workspaceRootAvailable ? (
              <div className="px-4 py-3 text-sm text-subtle-foreground">Select a workspace folder to mention files.</div>
            ) : (
              ROOT_OPTIONS.map((option, index) => {
                const isHighlighted = index === highlightedIndex
                const Icon = option.icon

                return (
                  <button
                    key={option.kind}
                    type="button"
                    role="option"
                    aria-selected={isHighlighted}
                    data-mention-index={index}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      onItemMouseDown?.()
                    }}
                    onMouseEnter={() => onHighlightIndex(index)}
                    onClick={() => onSelectCategory(option.kind)}
                    className={[
                      'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-[background-color,color,box-shadow]',
                      isHighlighted
                        ? 'bg-[var(--dropdown-option-active-surface)] text-foreground shadow-sm'
                        : 'text-foreground hover:bg-[var(--dropdown-option-active-surface)]',
                    ].join(' ')}
                  >
                    <Icon
                      size={17}
                      className={`shrink-0 ${
                        option.kind === 'file'
                          ? 'text-[#2563EB]'
                          : option.kind === 'folder'
                            ? 'text-[#F59E0B]'
                            : option.kind === 'skill'
                              ? 'text-[#A855F7]'
                              : 'text-[#10B981]'
                      }`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] leading-5">{option.label}</span>
                      <span className="block text-[12px] leading-5 text-subtle-foreground">{option.description}</span>
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      </div>
    ) : (
      <div
        ref={menuRef}
        role="listbox"
        aria-label={
          selectedMenuType === 'folder'
            ? 'Folder mentions'
            : selectedMenuType === 'file'
              ? 'File mentions'
              : selectedMenuType === 'skill'
                ? 'Skill mentions'
                : selectedMenuType === 'kanban'
                  ? 'Kanban mentions'
                  : 'File, folder, skill, and Kanban mentions'
        }
        data-floating-menu-root="true"
        className="fixed z-40 w-[min(26rem,calc(100vw-1rem))] overflow-hidden rounded-[22px] border border-border bg-surface shadow-[0_10px_30px_rgba(15,23,42,0.08)]"
        style={menuStyle}
      >
        <div className="max-h-[200px] overflow-y-auto" onMouseLeave={onResetHighlight}>
          {!workspaceRootAvailable ? (
            <div className="px-4 py-3 text-sm text-subtle-foreground">
              Select a workspace folder to mention files.
            </div>
          ) : loading ? (
            <div className="px-4 py-3 text-sm text-subtle-foreground">
              Loading mentions...
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-3 text-sm text-subtle-foreground">
              {searchQuery.trim().length > 0
                ? 'No matching options'
                : selectedMenuType === 'folder'
                  ? 'Type to search folders...'
                  : selectedMenuType === 'file'
                    ? 'Type to search files...'
                    : selectedMenuType === 'skill'
                      ? 'Type to search skills...'
                      : selectedMenuType === 'kanban'
                        ? 'Type to search Kanban items...'
                        : 'Type to search files, folders, skills, or Kanban items...'}
            </div>
          ) : (
            results.map((item, index) => {
              const isHighlighted = index === highlightedIndex
              const fileIconConfig = item.kind === 'file' ? resolveFileIconConfig({ fileName: item.relativePath }) : null
              const FileIcon = fileIconConfig?.icon

              return (
                <button
                  key={`${item.kind}-${item.relativePath}-${item.label}`}
                  type="button"
                  role="option"
                  aria-selected={isHighlighted}
                  data-mention-index={index}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    onItemMouseDown?.()
                  }}
                  onMouseEnter={() => onHighlightIndex(index)}
                  onClick={() => onSelect(item)}
                  className={[
                    'flex w-full items-center gap-2 px-4 py-2.5 text-left transition-[background-color,color,box-shadow]',
                    isHighlighted
                      ? 'bg-[var(--dropdown-option-active-surface)] text-foreground shadow-sm'
                      : 'text-foreground hover:bg-[var(--dropdown-option-active-surface)]',
                  ].join(' ')}
                >
                  {item.kind === 'skill' ? (
                    <Wand2 size={14} className="shrink-0 text-[#A855F7]" />
                  ) : item.kind === 'kanban' ? (
                    <ListTodo size={14} className="shrink-0 text-[#10B981]" />
                  ) : item.kind === 'folder' ? (
                    <Folder size={14} className="shrink-0 text-[#F59E0B]" />
                  ) : FileIcon ? (
                    <FileIcon size={14} className="shrink-0" style={{ color: fileIconConfig.color }} />
                  ) : (
                    <File size={14} className="shrink-0 text-[#2563EB]" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] leading-5">{item.label}</span>
                    <span className="block truncate text-[12px] leading-5 text-subtle-foreground">{item.description}</span>
                  </span>
                </button>
              )
            })
          )}
        </div>
      </div>
    )

  return anchorRef ? createPortal(content, document.body) : content
}
