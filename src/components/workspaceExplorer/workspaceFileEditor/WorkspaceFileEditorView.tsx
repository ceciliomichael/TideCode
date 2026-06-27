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
import { memo } from 'react'
import {
  EDITOR_BOTTOM_BUFFER_PX,
  renderHighlightedTokens,
  type WorkspaceEditorLineStatus,
} from './workspaceFileEditorUtils'
import type { WorkspaceFileEditorState } from './useWorkspaceFileEditorState'

interface WorkspaceFileEditorViewProps {
  editorState: WorkspaceFileEditorState
  fileName: string
  onChange: (nextValue: string) => void
  wordWrapEnabled: boolean
  value: string
}

function getLineNumberRowClassName(status: WorkspaceEditorLineStatus | null) {
  if (status === 'added') {
    return 'border-r-[3px] border-emerald-500/80'
  }

  if (status === 'changed') {
    return 'border-r-[3px] border-blue-500/80'
  }

  return 'border-r-[3px] border-transparent'
}


function SearchPanel({ editorState }: { editorState: WorkspaceFileEditorState }) {
  const { actions, refs, search } = editorState

  return (
    <div className="absolute right-4 top-3 z-20 w-[min(31rem,calc(100%-2rem))] overflow-hidden rounded-lg border border-[#2e2e2e] bg-[#1e1e1e] text-[#cccccc] shadow-sm">
      <div className="flex items-stretch">
        <div className="flex w-8 shrink-0 border-r border-[#2e2e2e]">
          <button
            type="button"
            onClick={() => search.setIsReplaceOpen((currentValue) => !currentValue)}
            className="inline-flex h-full min-h-8 w-full items-center justify-center text-[#c5c5c5] transition-colors hover:bg-[#2a2d2e] hover:text-white"
            aria-label={search.isReplaceOpen ? 'Hide replace input' : 'Show replace input'}
          >
            <VscChevronRight size={16} className={`transition-transform ${search.isReplaceOpen ? 'rotate-90' : 'rotate-0'}`} />
          </button>
        </div>
        <div className="min-w-0 flex-1 py-0.5 pr-1">
          <div className="flex min-h-8 items-center gap-1 pl-1 pr-1">
            <label className="sr-only" htmlFor="workspace-editor-search">
              Find in file
            </label>
            <input
              ref={refs.searchInputRef}
              id="workspace-editor-search"
              value={search.searchValue}
              onChange={(event) => search.setSearchValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  actions.closeSearchPanel()
                  return
                }
                if (event.key === 'Enter') {
                  event.preventDefault()
                  actions.moveSearchMatch(event.shiftKey ? -1 : 1)
                }
              }}
              placeholder="Find"
              aria-label="Find in current file"
              className="h-7 min-w-0 flex-1 rounded-lg border border-[#3c3c3c] bg-[#252526] px-2 text-[13px] text-[#d4d4d4] outline-none placeholder:text-[#8b8b8b]"
            />
            <button
              type="button"
              onClick={() => search.setIsMatchCaseEnabled((currentValue) => !currentValue)}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
                search.isMatchCaseEnabled ? 'bg-[#2a2d2e] text-white' : 'text-[#c5c5c5] hover:bg-[#2a2d2e] hover:text-white'
              }`}
              aria-label="Toggle match case"
              title="Match case"
            >
              <VscCaseSensitive size={16} />
            </button>
            <button
              type="button"
              onClick={() => search.setIsWholeWordEnabled((currentValue) => !currentValue)}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
                search.isWholeWordEnabled ? 'bg-[#2a2d2e] text-white' : 'text-[#c5c5c5] hover:bg-[#2a2d2e] hover:text-white'
              }`}
              aria-label="Toggle whole word"
              title="Match whole word"
            >
              <VscWholeWord size={16} />
            </button>
            <button
              type="button"
              onClick={() => search.setIsRegexEnabled((currentValue) => !currentValue)}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
                search.isRegexEnabled ? 'bg-[#2a2d2e] text-white' : 'text-[#c5c5c5] hover:bg-[#2a2d2e] hover:text-white'
              }`}
              aria-label="Toggle regular expression"
              title="Use regular expression"
            >
              <VscRegex size={16} />
            </button>
            <span className="min-w-16 px-1 text-center text-[12px] text-[#c5c5c5]">
              {search.totalSearchMatchCount > 0 ? `${search.activeSearchMatchIndex + 1} / ${search.totalSearchMatchCount}` : 'No results'}
            </span>
            <button
              type="button"
              onClick={() => actions.moveSearchMatch(-1)}
              disabled={search.totalSearchMatchCount === 0}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[#c5c5c5] transition-colors hover:bg-[#2a2d2e] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Previous match"
            >
              <VscArrowUp size={16} />
            </button>
            <button
              type="button"
              onClick={() => actions.moveSearchMatch(1)}
              disabled={search.totalSearchMatchCount === 0}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[#c5c5c5] transition-colors hover:bg-[#2a2d2e] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Next match"
            >
              <VscArrowDown size={16} />
            </button>
            <button
              type="button"
              onClick={actions.closeSearchPanel}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[#c5c5c5] transition-colors hover:bg-[#2a2d2e] hover:text-white"
              aria-label="Close find panel"
            >
              <VscClose size={16} />
            </button>
          </div>
          {search.isReplaceOpen ? (
            <div className="mt-px flex min-h-8 items-center gap-1 pl-1 pr-1">
              <label className="sr-only" htmlFor="workspace-editor-replace">
                Replace in file
              </label>
              <input
                ref={refs.replaceInputRef}
                id="workspace-editor-replace"
                value={search.replaceValue}
                onChange={(event) => search.setReplaceValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    actions.closeSearchPanel()
                    return
                  }
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    actions.handleReplaceCurrentMatch()
                  }
                }}
                placeholder="Replace"
                aria-label="Replace in current file"
                className="h-7 min-w-0 flex-1 rounded-lg border border-[#3c3c3c] bg-[#252526] px-2 text-[13px] text-[#d4d4d4] outline-none placeholder:text-[#8b8b8b]"
              />
              <button
                type="button"
                onClick={actions.handleReplaceCurrentMatch}
                disabled={search.totalSearchMatchCount === 0}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[#c5c5c5] transition-colors hover:bg-[#2a2d2e] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Replace current match"
                title="Replace"
              >
                <VscReplace size={16} />
              </button>
              <button
                type="button"
                onClick={actions.handleReplaceAllMatches}
                disabled={search.totalSearchMatchCount === 0}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[#c5c5c5] transition-colors hover:bg-[#2a2d2e] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Replace all matches"
                title="Replace All"
              >
                <VscReplaceAll size={16} />
              </button>
              <button
                type="button"
                disabled
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[#6f6f6f] opacity-60"
                aria-label="Preserve case"
                title="Preserve Case"
              >
                <VscPreserveCase size={16} />
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export const WorkspaceFileEditorView = memo(function WorkspaceFileEditorView({
  editorState,
  fileName,
  onChange,
  wordWrapEnabled,
  value,
}: WorkspaceFileEditorViewProps) {
  const { actions, layout, refs, search } = editorState

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 bg-surface">
      <div className="flex min-h-0 flex-1 min-w-0">
        <div
          ref={refs.lineNumbersRef}
          className="h-full shrink-0 overflow-hidden bg-surface workspace-editor-line-numbers"
          style={{ width: `${layout.gutterWidthCh}ch` }}
        >
          <pre
            className="m-0 py-1.5 text-[12px] leading-5 text-subtle-foreground"
            style={{ paddingBottom: `${EDITOR_BOTTOM_BUFFER_PX}px` }}
          >
            <code ref={refs.lineNumbersContentRef} className="block">
              {layout.topSpacerHeight > 0 ? <div aria-hidden="true" style={{ height: `${layout.topSpacerHeight}px` }} /> : null}
              {layout.lineNumberRows.map((row) => (
                <div
                  key={`line-number-${row.lineNumber}`}
                  className={`select-none px-2 text-right leading-5 ${getLineNumberRowClassName(row.status)}`}
                  style={{ minHeight: `${row.minHeight}px` }}
                >
                  {row.lineNumber}
                </div>
              ))}
              {layout.bottomSpacerHeight > 0 ? <div aria-hidden="true" style={{ height: `${layout.bottomSpacerHeight}px` }} /> : null}
            </code>
          </pre>
        </div>
        <div ref={refs.editorViewportRef} className="relative h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-surface">
          {search.isSearchOpen ? <SearchPanel editorState={editorState} /> : null}
          <textarea
            ref={refs.textAreaRef}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onScroll={actions.handleScroll}
            onKeyDown={actions.handleKeyDown}
            spellCheck={false}
            wrap={wordWrapEnabled ? 'soft' : 'off'}
            aria-label={`Editing ${fileName}`}
            style={{
              caretColor: 'var(--color-foreground)',
              color: 'transparent',
              paddingBottom: `${EDITOR_BOTTOM_BUFFER_PX}px`,
              scrollPaddingBottom: `${EDITOR_BOTTOM_BUFFER_PX}px`,
            }}
            className={layout.textAreaClassName}
          />
          <div
            ref={refs.highlightedLayerRef}
            className={`pointer-events-none absolute inset-0 px-3 py-1.5 font-mono text-[12px] leading-5 text-foreground workspace-editor-highlighted-layer workspace-editor-scrollbar ${
              wordWrapEnabled ? 'overflow-y-scroll overflow-x-hidden' : 'overflow-scroll'
            }`}
            style={{ paddingBottom: `${EDITOR_BOTTOM_BUFFER_PX}px` }}
            aria-hidden="true"
          >
            <pre className="m-0 min-w-full bg-transparent">
              <code ref={refs.highlightedContentRef} className={layout.highlightedCodeClassName}>
                {layout.topSpacerHeight > 0 ? <div aria-hidden="true" style={{ height: `${layout.topSpacerHeight}px` }} /> : null}
                {layout.visibleHighlightedLines.map((line, index) => {
                  const lineNumber = layout.visibleLineNumbers[index] ?? index + 1
                  const row = layout.lineNumberRows[index]

                  return (
                    <div
                      key={`editor-highlighted-${lineNumber}-${line.text.slice(0, 16)}`}
                      ref={(element) => {
                        actions.setHighlightedLineElement(lineNumber, element)
                      }}
                      className={layout.highlightedLineClassName}
                      style={{
                        minHeight: row ? `${row.minHeight}px` : undefined,
                      }}
                    >
                      {renderHighlightedTokens(line.tokens, layout.visibleSearchMatches[index] ?? [])}
                    </div>
                  )
                })}
                {layout.bottomSpacerHeight > 0 ? <div aria-hidden="true" style={{ height: `${layout.bottomSpacerHeight}px` }} /> : null}
              </code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
})
