import { ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { MarkdownRenderer } from '../../chat/MarkdownRenderer'
import { getPlanDisplayContent, getPlanStatus, type PlanReviewComment } from '../../../lib/planContracts'
import { WorkspacePlanActionsMenu } from './WorkspacePlanActionsMenu'
import { WorkspacePlanCommentsMenu } from './WorkspacePlanCommentsMenu'

interface WorkspacePlanPreviewProps {
  content: string
  isTruncated: boolean
  onImplementPlan: (relativePath: string) => void
  onRequestChanges: (relativePath: string, comments: PlanReviewComment[]) => void
  relativePath: string
}

function createCommentId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `plan-comment-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function getPlanLineCount(content: string) {
  return Math.max(1, content.replace(/\r\n?/gu, '\n').split('\n').length)
}

export function WorkspacePlanPreview({
  content,
  isTruncated,
  onImplementPlan,
  onRequestChanges,
  relativePath,
}: WorkspacePlanPreviewProps) {
  const [comments, setComments] = useState<PlanReviewComment[]>([])
  const [isImplementationSubmitted, setIsImplementationSubmitted] = useState(
    () => getPlanStatus(content) === 'implementation_started',
  )
  const [isRequestSubmitted, setIsRequestSubmitted] = useState(false)
  const previousContentRef = useRef(content)
  const isImplementationStarted = isImplementationSubmitted || getPlanStatus(content) === 'implementation_started'

  useEffect(() => {
    if (previousContentRef.current === content) {
      return
    }

    previousContentRef.current = content
    setComments([])
    setIsImplementationSubmitted(getPlanStatus(content) === 'implementation_started')
    setIsRequestSubmitted(false)
  }, [content])

  const handleAddComment = useCallback((comment: string) => {
    const normalizedComment = comment.trim().slice(0, 2000)
    if (normalizedComment.length === 0) {
      return
    }

    setComments((currentComments) => [
      ...currentComments,
      {
        comment: normalizedComment,
        id: createCommentId(),
        lineEnd: getPlanLineCount(content),
        lineStart: 1,
        quote: 'Entire plan',
      },
    ])
  }, [content])

  const handleRequestChanges = useCallback(() => {
    if (comments.length === 0 || isRequestSubmitted) {
      return
    }

    setIsRequestSubmitted(true)
    onRequestChanges(relativePath, comments)
  }, [comments, isRequestSubmitted, onRequestChanges, relativePath])

  const handleImplement = useCallback(() => {
    if (isImplementationSubmitted || isRequestSubmitted) {
      return
    }

    setComments([])
    setIsImplementationSubmitted(true)
    onImplementPlan(relativePath)
  }, [isImplementationSubmitted, isRequestSubmitted, onImplementPlan, relativePath])

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="shrink-0 border-b border-border bg-surface px-2">
        <div className="flex min-h-10 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden text-[12px] text-subtle-foreground">
            {relativePath.split(/[\\/]+/).filter((segment) => segment.length > 0).map((segment, index) => (
              <span key={`${segment}-${index}`} className="inline-flex min-w-0 shrink-0 items-center gap-1.5">
                {index > 0 ? <ChevronRight size={12} className="shrink-0 text-subtle-foreground/70" /> : null}
                <span className="truncate">{segment}</span>
              </span>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!isImplementationStarted ? (
              <WorkspacePlanCommentsMenu comments={comments} onAddComment={handleAddComment} />
            ) : null}
            <WorkspacePlanActionsMenu
              implementationDisabled={isImplementationStarted || isRequestSubmitted}
              isImplementationStarted={isImplementationStarted}
              implementationLabel={isImplementationStarted ? 'Implementation started' : 'Implement the plan'}
              onImplement={handleImplement}
              onRequestChanges={handleRequestChanges}
              requestChangesDisabled={comments.length === 0 || isRequestSubmitted || isImplementationStarted}
              requestChangesLabel={isRequestSubmitted ? 'Changes requested' : 'Request changes'}
            />
          </div>
        </div>
      </header>

      {isTruncated ? (
        <div className="mx-5 mt-4 shrink-0 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 md:mx-7">
          This plan is truncated. Review the saved file directly before approving it.
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-5 py-6 md:px-10 md:py-8">
          <MarkdownRenderer
            key={content}
            content={getPlanDisplayContent(content)}
            className="workspace-plan-markdown"
            preserveLineBreaks
          />
        </div>
      </div>

    </div>
  )
}
