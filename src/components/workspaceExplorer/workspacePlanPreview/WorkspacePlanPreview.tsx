import { useCallback, useEffect, useRef, useState } from 'react'
import { MarkdownRenderer } from '../../chat/MarkdownRenderer'
import { getPlanDisplayContent, getPlanStatus, type PlanReviewComment } from '../../../lib/planContracts'
import { PLAN_HANDOFF_SUCCESS_LABEL } from '../../../lib/planStatusMessages'
import { WorkspacePlanActionsMenu } from './WorkspacePlanActionsMenu'
import { WorkspacePlanCommentsMenu } from './WorkspacePlanCommentsMenu'

interface WorkspacePlanPreviewProps {
  comments: readonly PlanReviewComment[]
  content: string
  isTruncated: boolean
  onCommentsChange: (relativePath: string, comments: readonly PlanReviewComment[]) => void
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
  comments,
  content,
  isTruncated,
  onCommentsChange,
  onImplementPlan,
  onRequestChanges,
  relativePath,
}: WorkspacePlanPreviewProps) {
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
    onCommentsChange(relativePath, [])
    setIsImplementationSubmitted(getPlanStatus(content) === 'implementation_started')
    setIsRequestSubmitted(false)
  }, [content, onCommentsChange, relativePath])

  const handleAddComment = useCallback((comment: string) => {
    const normalizedComment = comment.trim().slice(0, 2000)
    if (normalizedComment.length === 0) {
      return
    }

    onCommentsChange(relativePath, [
      ...comments,
      {
        comment: normalizedComment,
        id: createCommentId(),
        lineEnd: getPlanLineCount(content),
        lineStart: 1,
        quote: 'Entire plan',
      },
    ])
  }, [comments, content, onCommentsChange, relativePath])

  const handleRequestChanges = useCallback(() => {
    if (comments.length === 0 || isRequestSubmitted) {
      return
    }

    setIsRequestSubmitted(true)
    onRequestChanges(relativePath, [...comments])
  }, [comments, isRequestSubmitted, onRequestChanges, relativePath])

  const handleImplement = useCallback(() => {
    if (isImplementationSubmitted || isRequestSubmitted) {
      return
    }

    onCommentsChange(relativePath, [])
    setIsImplementationSubmitted(true)
    onImplementPlan(relativePath)
  }, [isImplementationSubmitted, isRequestSubmitted, onCommentsChange, onImplementPlan, relativePath])

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background text-foreground">
      <header className="shrink-0 bg-background px-2">
        <div className="flex min-h-10 items-center justify-end gap-2">
          <div className="flex shrink-0 items-center gap-2">
            {!isImplementationStarted ? (
              <WorkspacePlanCommentsMenu comments={comments} onAddComment={handleAddComment} />
            ) : null}
            <WorkspacePlanActionsMenu
              implementationDisabled={isImplementationStarted || isRequestSubmitted}
              isImplementationStarted={isImplementationStarted}
              implementationLabel={isImplementationStarted ? PLAN_HANDOFF_SUCCESS_LABEL : 'Implement the plan'}
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
