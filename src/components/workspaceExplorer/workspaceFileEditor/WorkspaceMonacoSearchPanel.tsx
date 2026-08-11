import type { Dispatch, RefObject, SetStateAction } from 'react'
import {
  VscArrowDown,
  VscArrowUp,
  VscCaseSensitive,
  VscChevronRight,
  VscClose,
  VscPreserveCase,
  VscRegex,
  VscReplace,
  VscReplaceAll,
  VscWholeWord,
} from 'react-icons/vsc'
import { Tooltip } from '../../Tooltip'

export interface WorkspaceMonacoSearchPanelProps {
  activeMatchIndex: number
  closeSearchPanel: () => void
  isMatchCaseEnabled: boolean
  isOpen: boolean
  isRegexEnabled: boolean
  isReplaceOpen: boolean
  isWholeWordEnabled: boolean
  moveSearchMatch: (direction: 1 | -1) => void
  replaceAllMatches: () => void
  replaceCurrentMatch: () => void
  replaceInputRef: RefObject<HTMLInputElement>
  replaceValue: string
  searchInputRef: RefObject<HTMLInputElement>
  searchValue: string
  setIsMatchCaseEnabled: Dispatch<SetStateAction<boolean>>
  setIsRegexEnabled: Dispatch<SetStateAction<boolean>>
  setIsReplaceOpen: Dispatch<SetStateAction<boolean>>
  setIsWholeWordEnabled: Dispatch<SetStateAction<boolean>>
  setReplaceValue: Dispatch<SetStateAction<string>>
  setSearchValue: (nextValue: string) => void
  totalMatchCount: number
}

function optionButtonClassName(active: boolean) {
  return [
    'inline-flex h-7 w-7 items-center justify-center rounded-lg transition-colors',
    active
      ? 'bg-[var(--workspace-find-widget-hover)] text-[var(--workspace-find-widget-foreground)]'
      : 'text-[var(--workspace-find-widget-muted)] hover:bg-[var(--workspace-find-widget-hover)] hover:text-[var(--workspace-find-widget-foreground)]',
  ].join(' ')
}

const actionButtonClassName = 'inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--workspace-find-widget-muted)] transition-colors hover:bg-[var(--workspace-find-widget-hover)] hover:text-[var(--workspace-find-widget-foreground)] disabled:cursor-not-allowed disabled:opacity-40'

export function WorkspaceMonacoSearchPanel({
  activeMatchIndex,
  closeSearchPanel,
  isMatchCaseEnabled,
  isOpen,
  isRegexEnabled,
  isReplaceOpen,
  isWholeWordEnabled,
  moveSearchMatch,
  replaceAllMatches,
  replaceCurrentMatch,
  replaceInputRef,
  replaceValue,
  searchInputRef,
  searchValue,
  setIsMatchCaseEnabled,
  setIsRegexEnabled,
  setIsReplaceOpen,
  setIsWholeWordEnabled,
  setReplaceValue,
  setSearchValue,
  totalMatchCount,
}: WorkspaceMonacoSearchPanelProps) {
  if (!isOpen) {
    return null
  }

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>, replaceInput: boolean) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeSearchPanel()
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      if (replaceInput && (event.ctrlKey || event.metaKey)) {
        replaceCurrentMatch()
        return
      }
      moveSearchMatch(event.shiftKey ? -1 : 1)
    }
  }

  return (
    <div className="workspace-monaco-search-panel absolute right-4 top-3 z-50 w-[min(31rem,calc(100%-2rem))] overflow-hidden rounded-lg border border-[var(--workspace-find-widget-border)] bg-[var(--workspace-find-widget-surface)] text-[var(--workspace-find-widget-foreground)] shadow-sm">
      <div className="flex items-stretch">
        <div className="flex w-8 shrink-0 border-r border-[var(--workspace-find-widget-border)]">
          <button
            type="button"
            onClick={() => setIsReplaceOpen((currentValue) => !currentValue)}
            className="inline-flex h-full min-h-8 w-full items-center justify-center text-[var(--workspace-find-widget-muted)] transition-colors hover:bg-[var(--workspace-find-widget-hover)] hover:text-[var(--workspace-find-widget-foreground)]"
            aria-label={isReplaceOpen ? 'Hide replace input' : 'Show replace input'}
          >
            <VscChevronRight size={16} className={`transition-transform ${isReplaceOpen ? 'rotate-90' : 'rotate-0'}`} />
          </button>
        </div>

        <div className="min-w-0 flex-1 py-0.5 pr-1">
          <div className="flex min-h-8 items-center gap-1 px-1">
            <input
              ref={searchInputRef}
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              onKeyDown={(event) => handleInputKeyDown(event, false)}
              placeholder="Find"
              aria-label="Find in current file"
              spellCheck={false}
              className="h-7 min-w-0 flex-1 rounded-lg border border-[var(--workspace-find-widget-input-border)] bg-[var(--workspace-find-widget-input-surface)] px-2 text-[13px] text-[var(--workspace-find-widget-foreground)] outline-none placeholder:text-[var(--workspace-find-widget-muted)]"
            />

            <Tooltip content="Match case" side="bottom" noWrap>
              <button
                type="button"
                onClick={() => setIsMatchCaseEnabled((currentValue) => !currentValue)}
                className={optionButtonClassName(isMatchCaseEnabled)}
                aria-label="Toggle match case"
                aria-pressed={isMatchCaseEnabled}
              >
                <VscCaseSensitive size={16} />
              </button>
            </Tooltip>
            <Tooltip content="Match whole word" side="bottom" noWrap>
              <button
                type="button"
                onClick={() => setIsWholeWordEnabled((currentValue) => !currentValue)}
                className={optionButtonClassName(isWholeWordEnabled)}
                aria-label="Toggle match whole word"
                aria-pressed={isWholeWordEnabled}
              >
                <VscWholeWord size={16} />
              </button>
            </Tooltip>
            <Tooltip content="Use regular expression" side="bottom" noWrap>
              <button
                type="button"
                onClick={() => setIsRegexEnabled((currentValue) => !currentValue)}
                className={optionButtonClassName(isRegexEnabled)}
                aria-label="Toggle regular expression"
                aria-pressed={isRegexEnabled}
              >
                <VscRegex size={16} />
              </button>
            </Tooltip>

            <span className="min-w-16 px-1 text-center text-[12px] text-[var(--workspace-find-widget-muted)]">
              {totalMatchCount > 0 ? `${activeMatchIndex + 1} / ${totalMatchCount}` : 'No results'}
            </span>
            <button
              type="button"
              onClick={() => moveSearchMatch(-1)}
              disabled={totalMatchCount === 0}
              className={actionButtonClassName}
              aria-label="Previous match"
            >
              <VscArrowUp size={16} />
            </button>
            <button
              type="button"
              onClick={() => moveSearchMatch(1)}
              disabled={totalMatchCount === 0}
              className={actionButtonClassName}
              aria-label="Next match"
            >
              <VscArrowDown size={16} />
            </button>
            <button
              type="button"
              onClick={closeSearchPanel}
              className={actionButtonClassName}
              aria-label="Close find panel"
            >
              <VscClose size={16} />
            </button>
          </div>

          {isReplaceOpen ? (
            <div className="mt-px flex min-h-8 items-center gap-1 px-1">
              <input
                ref={replaceInputRef}
                value={replaceValue}
                onChange={(event) => setReplaceValue(event.target.value)}
                onKeyDown={(event) => handleInputKeyDown(event, true)}
                placeholder="Replace"
                aria-label="Replace in current file"
                spellCheck={false}
                className="h-7 min-w-0 flex-1 rounded-lg border border-[var(--workspace-find-widget-input-border)] bg-[var(--workspace-find-widget-input-surface)] px-2 text-[13px] text-[var(--workspace-find-widget-foreground)] outline-none placeholder:text-[var(--workspace-find-widget-muted)]"
              />
              <Tooltip content="Replace" side="bottom" noWrap>
                <button
                  type="button"
                  onClick={replaceCurrentMatch}
                  disabled={totalMatchCount === 0}
                  className={actionButtonClassName}
                  aria-label="Replace current match"
                >
                  <VscReplace size={16} />
                </button>
              </Tooltip>
              <Tooltip content="Replace all" side="bottom" noWrap>
                <button
                  type="button"
                  onClick={replaceAllMatches}
                  disabled={totalMatchCount === 0}
                  className={actionButtonClassName}
                  aria-label="Replace all matches"
                >
                  <VscReplaceAll size={16} />
                </button>
              </Tooltip>
              <Tooltip content="Preserve case" side="bottom" noWrap>
                <button
                  type="button"
                  disabled
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--workspace-find-widget-muted)] opacity-40"
                  aria-label="Preserve case"
                >
                  <VscPreserveCase size={16} />
                </button>
              </Tooltip>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
