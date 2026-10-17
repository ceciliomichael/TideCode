import type { PlanReviewComment } from './planContracts'

export function formatPlanReviewRequest(relativePath: string, comments: readonly PlanReviewComment[]) {
  const reviewLines = comments.flatMap((comment) => [
    comment.quote === 'Entire plan'
      ? '- Entire plan'
      : `- Lines ${comment.lineStart}${comment.lineEnd === comment.lineStart ? '' : `–${comment.lineEnd}`}: “${comment.quote}”`,
    `  Requested change: ${comment.comment}`,
  ])

  return [
    `Please revise the implementation plan at ${relativePath} using the review comments below.`,
    'Use tools.patch inside exec to update only that exact active plan. Read its current Markdown before building the patch and return the revised plan for another review.',
    '',
    ...reviewLines,
  ].join('\n')
}
