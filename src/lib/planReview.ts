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
    'Use plan_edit to update the plan file, keep the plan focused on the requested changes, and return the revised plan for another review.',
    '',
    ...reviewLines,
  ].join('\n')
}
