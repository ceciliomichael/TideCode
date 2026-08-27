import { memo } from 'react'
import { DiffViewer } from './DiffViewer'
import type { ChangeDiffToolResultPresentation } from '../../types/chat'

interface FileChangeDiffResultProps {
  parsedResult: ChangeDiffToolResultPresentation
}

export const ChangeDiffResult = memo(function ChangeDiffResult({ parsedResult }: FileChangeDiffResultProps) {
  if (parsedResult.changes.length === 0) {
    return null
  }

  const firstFileName = parsedResult.changes[0]?.fileName.trim().replaceAll(String.fromCharCode(92), '/')
  const isSingleFile = Boolean(firstFileName) && parsedResult.changes.every(
    (change) => change.fileName.trim().replaceAll(String.fromCharCode(92), '/') === firstFileName,
  )

  if (parsedResult.changes.length > 1 && isSingleFile) {
    return (
      <div className="my-2 w-full overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
        {parsedResult.changes.map((change, index) => (
          <DiffViewer
            key={`${change.fileName}:${change.kind}:${index}`}
            contextLines={change.contextLines}
            filePath={change.fileName}
            headerTrailingContent={null}
            isStreaming={false}
            layout="stacked"
            maxBodyHeightClassName="max-h-80"
            newContent={change.newContent}
            oldContent={change.oldContent}
            showHeader={index === 0}
            startLineNumber={change.startLineNumber}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {parsedResult.changes.map((change, index) => (
        <div key={`${change.fileName}:${change.kind}:${index}`} className="space-y-2">
          <DiffViewer
            filePath={change.fileName}
            headerTrailingContent={null}
            isStreaming={false}
            newContent={change.newContent}
            oldContent={change.oldContent}
            startLineNumber={change.startLineNumber}
            contextLines={change.contextLines}
            maxBodyHeightClassName="max-h-80"
          />
        </div>
      ))}
    </div>
  )
})
