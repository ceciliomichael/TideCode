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
  if (!isOpen) {
    return null
  }

  return (
    <div
      data-tool-diff-result="open"
      className={[
        'w-full text-sm text-muted-foreground/90 [&>*:last-child]:mb-0',
        'mt-1.5',
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
