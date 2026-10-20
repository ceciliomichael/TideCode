import type { ImageToolResultPresentation } from '../../types/chat'
import { ToolImageResult } from './ToolImageResult'
import { LiteralToolResult } from './LiteralToolResult'

interface ToolBrowserReadResultProps {
  conversationId?: string | null
  presentation?: ImageToolResultPresentation | null
  workspaceRootPath: string | null
  details: string
}

export function ToolBrowserReadResult({
  conversationId, presentation, workspaceRootPath, details,
}: ToolBrowserReadResultProps) {
  return (
    <div className="flex w-full min-w-0 flex-col items-start gap-2">
      {presentation ? (
        <div className="w-fit max-w-full">
          <ToolImageResult
            conversationId={conversationId}
            presentation={presentation}
            workspaceRootPath={workspaceRootPath}
          />
        </div>
      ) : null}
      <div className="w-full min-w-0 max-h-80 overflow-y-auto pr-1">
        <LiteralToolResult content={details} />
      </div>
    </div>
  )
}
