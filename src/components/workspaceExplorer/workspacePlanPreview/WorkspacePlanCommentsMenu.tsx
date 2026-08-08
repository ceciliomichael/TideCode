import { MessageSquare, Plus, Send, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { PlanReviewComment } from '../../../lib/planContracts'

interface WorkspacePlanCommentsMenuProps {
  comments: readonly PlanReviewComment[]
  onAddComment: (comment: string) => void
}

function getCommentLocationLabel(comment: PlanReviewComment) {
  if (comment.quote === 'Entire plan') {
    return 'Entire plan'
  }

  return `Lines ${comment.lineStart}${comment.lineEnd === comment.lineStart ? '' : `–${comment.lineEnd}`}`
}

export function WorkspacePlanCommentsMenu({ comments, onAddComment }: WorkspacePlanCommentsMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isComposerOpen, setIsComposerOpen] = useState(false)
  const [commentDraft, setCommentDraft] = useState('')
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setIsOpen(false)
        setIsComposerOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false)
        setIsComposerOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  function handleAddComment() {
    const normalizedComment = commentDraft.trim().slice(0, 2000)
    if (normalizedComment.length === 0) {
      return
    }

    onAddComment(normalizedComment)
    setCommentDraft('')
    setIsComposerOpen(false)
  }

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label="Show plan comments"
        onClick={() => setIsOpen((currentValue) => !currentValue)}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-muted px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-muted/80 active:scale-[0.98]"
      >
        <MessageSquare size={14} aria-hidden="true" />
        Comments
        {comments.length > 0 ? (
          <span className="rounded-md bg-surface px-1.5 py-0.5 text-[11px] text-muted-foreground">
            {comments.length}
          </span>
        ) : null}
      </button>

      {isOpen ? (
        <div
          role="dialog"
          aria-label="Plan comments"
          className="absolute right-0 top-[calc(100%+6px)] z-[1200] w-[min(360px,calc(100vw-24px))] overflow-hidden rounded-xl border border-border bg-surface shadow-soft"
        >
          <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5">
            <div>
              <p className="text-sm font-semibold text-foreground">Comments</p>
              <p className="text-[11px] text-muted-foreground">
                {comments.length === 0 ? 'No comments yet.' : `${comments.length} comment${comments.length === 1 ? '' : 's'}`}
              </p>
            </div>
            <button
              type="button"
              aria-label="Close comments"
              onClick={() => {
                setIsOpen(false)
                setIsComposerOpen(false)
              }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>

          <div className="max-h-64 space-y-2 overflow-y-auto p-2.5">
            {comments.length > 0 ? (
              comments.map((comment, index) => (
                <div key={comment.id} className="rounded-lg border border-border bg-surface-muted/60 px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-brand">Comment {index + 1}</p>
                    <p className="text-[11px] text-subtle-foreground">{getCommentLocationLabel(comment)}</p>
                  </div>
                  <p className="mt-1 text-sm leading-5 text-foreground">{comment.comment}</p>
                </div>
              ))
            ) : (
              <p className="px-1 py-3 text-sm text-muted-foreground">Add a note for the whole plan from this menu.</p>
            )}
          </div>

          <div className="border-t border-border p-2.5">
            {isComposerOpen ? (
              <div className="space-y-2">
                <textarea
                  autoFocus
                  value={commentDraft}
                  onChange={(event) => setCommentDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                      event.preventDefault()
                      handleAddComment()
                    }
                  }}
                  maxLength={2000}
                  placeholder="What should change?"
                  aria-label="New plan comment"
                  className="min-h-20 w-full resize-y rounded-lg border border-border bg-surface-muted px-2.5 py-2 text-sm text-foreground outline-none placeholder:text-subtle-foreground focus:border-border focus:outline-none focus:ring-0"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsComposerOpen(false)
                      setCommentDraft('')
                    }}
                    className="inline-flex min-h-9 items-center rounded-lg px-2.5 text-xs text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleAddComment}
                    disabled={commentDraft.trim().length === 0}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-xs font-medium text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Send size={13} aria-hidden="true" />
                    Add comment
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsComposerOpen(true)}
                className="inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-surface-muted px-3 text-xs font-medium text-foreground transition-colors hover:bg-surface-muted/80"
              >
                <Plus size={14} aria-hidden="true" />
                Add comment
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
