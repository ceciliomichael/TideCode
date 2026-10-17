import { File, Folder, Plug, Wand2 } from 'lucide-react'
import { createPortal } from 'react-dom'
import type { CSSProperties, RefObject } from 'react'
import { resolveFileIconConfig } from '../../lib/fileIconResolver'
import { CHAT_MENTION_CATEGORIES, type ChatMentionMenuItem, type ChatMentionMenuType } from './chatMentionCatalog'

interface ChatMentionMenuProps {
  categories: typeof CHAT_MENTION_CATEGORIES
  anchorRef: RefObject<HTMLElement | null>
  isOpen: boolean
  loading: boolean
  menuRef: RefObject<HTMLDivElement | null>
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

export function ChatMentionMenu({
  categories,
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
        className="fixed z-40 w-[min(26rem,calc(100vw-1rem))] overflow-hidden rounded-[22px] border border-border bg-surface-raised shadow-soft"
        style={menuStyle}
      >
        <div onMouseLeave={onResetHighlight}>
          <div>
            {!workspaceRootAvailable ? (
              <div className="px-4 py-3 text-sm text-subtle-foreground">Select a workspace folder to mention files.</div>
            ) : (
              categories.map((option, index) => {
                const isHighlighted = index === highlightedIndex
                const Icon = option.icon

                return (
                  <button
                    key={option.kind}
                    type="button"
                    role="option"
                    aria-selected={isHighlighted}
                    data-mention-index={index}
                    onPointerDown={(event) => {
                      event.preventDefault()
                      onItemMouseDown?.()
                    }}
                    onMouseEnter={() => onHighlightIndex(index)}
                    onClick={() => onSelectCategory(option.kind)}
                    className={[
                      'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-[background-color,color,box-shadow]',
                      isHighlighted
                        ? 'bg-[var(--dropdown-option-hover-surface)] text-foreground shadow-sm'
                        : 'text-foreground hover:bg-[var(--dropdown-option-hover-surface)]',
                    ].join(' ')}
                  >
                    <Icon
                      size={17}
                      className={`shrink-0 ${
                        option.kind === 'file'
                          ? 'text-info-foreground'
                          : option.kind === 'folder'
                            ? 'text-warning-foreground'
                            : option.kind === 'attachment'
                              ? 'text-muted-foreground'
                              : option.kind === 'skill'
                                ? 'text-brand'
                                : 'text-mcp-foreground'
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
              : selectedMenuType === 'attachment'
                ? 'Attachment mentions'
                : selectedMenuType === 'skill'
                  ? 'Skill mentions'
                  : selectedMenuType === 'mcp'
                    ? 'MCP mentions'
                    : 'File, folder, attachment, skill, and MCP mentions'
        }
        data-floating-menu-root="true"
        className="fixed z-40 w-[min(26rem,calc(100vw-1rem))] overflow-hidden rounded-[22px] border border-border bg-surface-raised shadow-soft"
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
                    : selectedMenuType === 'attachment'
                      ? 'No attachments in this chat yet'
                      : selectedMenuType === 'skill'
                        ? 'Type to search skills...'
                        : selectedMenuType === 'mcp'
                          ? 'No MCP servers available'
                          : 'Type to search files, folders, attachments, skills, or MCPs...'}
            </div>
          ) : (
            results.map((item, index) => {
              const isHighlighted = index === highlightedIndex
              const fileIconConfig =
                item.kind === 'file' || (item.kind === 'attachment' && !item.isDirectory)
                  ? resolveFileIconConfig({ fileName: item.relativePath })
                  : null
              const FileIcon = fileIconConfig?.icon

              return (
                <button
                  key={`${item.kind}-${item.relativePath}-${item.label}`}
                  type="button"
                  role="option"
                  aria-selected={isHighlighted}
                  data-mention-index={index}
                  onPointerDown={(event) => {
                    event.preventDefault()
                    onItemMouseDown?.()
                  }}
                  onMouseEnter={() => onHighlightIndex(index)}
                  onClick={() => onSelect(item)}
                  className={[
                    'flex w-full items-center gap-2 px-4 py-2.5 text-left transition-[background-color,color,box-shadow]',
                    isHighlighted
                      ? 'bg-[var(--dropdown-option-hover-surface)] text-foreground shadow-sm'
                      : 'text-foreground hover:bg-[var(--dropdown-option-hover-surface)]',
                  ].join(' ')}
                >
                  {item.kind === 'mcp' ? (
                    <Plug size={14} className="shrink-0 text-mcp-foreground" />
                  ) : item.kind === 'skill' ? (
                    <Wand2 size={14} className="shrink-0 text-brand" />
                  ) : item.kind === 'folder' || (item.kind === 'attachment' && item.isDirectory) ? (
                    <Folder size={14} className="shrink-0 text-warning-foreground" />
                  ) : FileIcon ? (
                    <FileIcon size={14} className="shrink-0" style={{ color: fileIconConfig.color }} />
                  ) : (
                    <File size={14} className="shrink-0 text-info-foreground" />
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
