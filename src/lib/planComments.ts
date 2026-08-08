import { normalizePlanRelativePath, type PlanReviewComment } from './planContracts'

export type PlanCommentsByPath = Record<string, PlanReviewComment[]>

export function getPlanCommentsForPath(
  commentsByPath: Readonly<PlanCommentsByPath>,
  relativePath: string,
): readonly PlanReviewComment[] {
  return commentsByPath[normalizePlanRelativePath(relativePath)] ?? []
}

export function setPlanCommentsForPath(
  commentsByPath: Readonly<PlanCommentsByPath>,
  relativePath: string,
  comments: readonly PlanReviewComment[],
): PlanCommentsByPath {
  const normalizedPath = normalizePlanRelativePath(relativePath)
  const nextCommentsByPath: PlanCommentsByPath = { ...commentsByPath }

  if (comments.length === 0) {
    delete nextCommentsByPath[normalizedPath]
    return nextCommentsByPath
  }

  nextCommentsByPath[normalizedPath] = comments.map((comment) => ({ ...comment }))
  return nextCommentsByPath
}
