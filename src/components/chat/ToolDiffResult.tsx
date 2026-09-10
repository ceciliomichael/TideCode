import { memo } from 'react'
import type { ChangeDiffToolResultPresentation, FileDiffToolResultPresentation } from '../../types/chat'
import { DiffViewer } from './DiffViewer'
import { ChangeDiffResult } from './FileChangeDiffResult'

interface ToolDiffResultProps {
  isOpen: boolean
  isStreaming: boolean
  presentation: ChangeDiffToolResultPresentation | FileDiffToolResultPresentation
}

export const ToolDiffResult = memo(function ToolDiffResult({
  isOpen,
  isStreaming,
  presentation,
}: ToolDiffResultProps) {
  return (
    <div
      aria-hidden={isOpen ? undefined : true}
      data-tool-diff-result={isOpen ? 'open' : 'premeasure'}
      className={[
        'w-full text-sm text-muted-foreground/90 [&>*:last-child]:mb-0',
        isOpen
          ? 'mt-1.5'
          : 'pointer-events-none invisible absolute inset-x-0 top-0 h-0 overflow-hidden',
      ].join(' ')}
    >
      {presentation.kind === 'file_diff' ? (
        <DiffViewer
          contextLines={presentation.contextLines}
          filePath={presentation.fileName}
          isStreaming={isStreaming}
          maxBodyHeightClassName="max-h-80"
          newContent={presentation.newContent}
          oldContent={presentation.oldContent}
          startLineNumber={presentation.startLineNumber}
        />
      ) : (
        <ChangeDiffResult parsedResult={presentation} />
      )}
    </div>
  )
})
