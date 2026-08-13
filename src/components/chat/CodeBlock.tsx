import { Check, Copy } from 'lucide-react'
import { lazy, memo, Suspense, useEffect, useState } from 'react'
import { useHighlightedCodeLines } from '../../hooks/useHighlightedCodeLines'
import { resolveFileIconConfig } from '../../lib/fileIconResolver'
import { HighlightedCodeLine } from './HighlightedCodeLine'
import type { HighlightedCodeLine as HighlightedCodeLineData } from '../../lib/codeHighlighting'
import { Tooltip } from '../Tooltip'
import { preloadWorkspaceMonacoCodeView } from '../../lib/workspaceMonacoPreload'

const WorkspaceMonacoCodeView = lazy(async () => {
  const module = await preloadWorkspaceMonacoCodeView()
  return { default: module.WorkspaceMonacoCodeView }
})

interface CodeBlockProps {
  code: string
  fileName?: string
  headerLabel?: string
  headerRightLabel?: string
  language?: string
  isStreaming?: boolean
  maxBodyHeightClassName?: string
  showCopyButton?: boolean
  showHeader?: boolean
  showHeaderTooltip?: boolean
  useMonaco?: boolean
  fillHeight?: boolean
  showLineNumberDivider?: boolean
  startLineNumber?: number
  className?: string
  bodyClassName?: string
}

function toLanguageLabel(language: string | undefined, resolvedLabel: string) {
  if (!language || language.trim().length === 0) {
    return 'Text'
  }
  if (resolvedLabel !== 'Code') {
    return resolvedLabel
  }
  const normalized = language.trim()
  return normalized.length <= 4 ? normalized.toUpperCase() : normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

interface CodeRowsProps {
  lines: readonly HighlightedCodeLineData[]
  startLineNumber: number
  fillHeight?: boolean
  showLineNumberDivider?: boolean
}

const LINE_NUMBER_GUTTER_WIDTH_CH = 5

const CodeRows = memo(function CodeRows({
  lines,
  startLineNumber,
  fillHeight = false,
  showLineNumberDivider = true,
}: CodeRowsProps) {
  return (
    <div className={['flex min-w-0 bg-surface', fillHeight ? 'h-full' : ''].join(' ')}>
      <div
        className={['select-none shrink-0 bg-surface', showLineNumberDivider ? 'border-r border-border' : ''].join(' ')}
        style={{
          width: `calc(${LINE_NUMBER_GUTTER_WIDTH_CH}ch + 1rem)`,
          minWidth: `calc(${LINE_NUMBER_GUTTER_WIDTH_CH}ch + 1rem)`,
          flex: `0 0 calc(${LINE_NUMBER_GUTTER_WIDTH_CH}ch + 1rem)`,
        }}
      >
        <pre className="m-0 py-2 text-[12px] leading-5 text-subtle-foreground">
          <code className="block">
            {lines.map((_, index) => {
              const lineNumber = startLineNumber + index
              return (
                <div
                  key={`line-number-${lineNumber}`}
                  className="select-none px-2 text-right"
                >
                  {lineNumber}
                </div>
              )
            })}
          </code>
        </pre>
      </div>
      <div className="min-w-0 flex-1 bg-surface">
        <pre className="m-0 min-w-full bg-transparent px-3 py-2 text-[12px] leading-5 text-foreground">
          <code className="block w-fit min-w-full bg-transparent">
            {lines.map((line, index) => (
              <div key={`content-${index}-${line.text.slice(0, 16)}`} className="code-block-line whitespace-pre">
                <HighlightedCodeLine line={line} />
              </div>
            ))}
          </code>
        </pre>
      </div>
    </div>
  )
})

export const CodeBlock = memo(function CodeBlock({
  code,
  fileName,
  headerLabel,
  headerRightLabel,
  language,
  maxBodyHeightClassName,
  showCopyButton = true,
  showHeader = true,
  showHeaderTooltip: _showHeaderTooltip = false,
  useMonaco = true,
  fillHeight = false,
  showLineNumberDivider = true,
  startLineNumber = 1,
  className,
  bodyClassName,
}: CodeBlockProps) {
  const [isCopied, setIsCopied] = useState(false)
  const highlightedLines = useHighlightedCodeLines(code, { fileName, language, stripTrailingNewline: true })
  const iconConfig = resolveFileIconConfig({ fileName, languageId: language })
  const titleLabel = headerLabel ?? fileName ?? toLanguageLabel(language, iconConfig.label)
  const LanguageIcon = iconConfig.icon

  useEffect(() => {
    if (!isCopied) {
      return
    }
    const timeoutId = window.setTimeout(() => {
      setIsCopied(false)
    }, 1400)
    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [isCopied])

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code)
      setIsCopied(true)
    } catch {
      setIsCopied(false)
    }
  }

  return (
    <div className={['my-2 overflow-hidden rounded-xl border border-border bg-surface shadow-sm', className ?? ''].join(' ')}>
      {showHeader ? (
        <div className="flex items-center gap-3 border-b border-border bg-surface px-3 py-1 text-[12px] text-muted-foreground">
          <span className="inline-flex min-h-4 min-w-0 flex-1 items-center gap-2">
            <span className="flex h-4 w-4 items-center justify-center">
              <LanguageIcon size={14} style={{ color: iconConfig.color }} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1 truncate leading-[1] text-foreground">{titleLabel}</span>
          </span>
          <span className="ml-auto inline-flex shrink-0 items-center gap-3">
            {headerRightLabel ? (
              <Tooltip content={headerRightLabel} side="top" noWrap>
                <span className="font-mono text-[11px] leading-none text-muted-foreground">{headerRightLabel}</span>
              </Tooltip>
            ) : null}
            {showCopyButton ? (
              <Tooltip content={isCopied ? 'Copied' : 'Copy'} side="top" noWrap>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-[color,transform] hover:scale-105 hover:text-foreground"
                  aria-label={isCopied ? 'Copied code' : 'Copy code'}
                >
                  {isCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
              </Tooltip>
            ) : null}
          </span>
        </div>
      ) : null}
      <div
        className={[
          'overflow-x-auto',
          maxBodyHeightClassName ? `${maxBodyHeightClassName} overflow-y-auto` : '',
          bodyClassName ?? '',
        ]
          .filter((value) => value.length > 0)
          .join(' ')}
      >
        <div className={['min-w-0 bg-surface font-mono text-[12px] leading-5', fillHeight ? 'h-full' : ''].join(' ')}>
          {useMonaco ? (
            <Suspense fallback={<CodeRows lines={highlightedLines} startLineNumber={startLineNumber} fillHeight={fillHeight} showLineNumberDivider={showLineNumberDivider} />}>
              <WorkspaceMonacoCodeView
                code={code}
                fileName={fileName}
                language={language}
                startLineNumber={startLineNumber}
                maxBodyHeightClassName={maxBodyHeightClassName}
              />
            </Suspense>
          ) : (
            <CodeRows
              lines={highlightedLines}
              startLineNumber={startLineNumber}
              fillHeight={fillHeight}
              showLineNumberDivider={showLineNumberDivider}
            />
          )}
        </div>
      </div>
    </div>
  )
})
