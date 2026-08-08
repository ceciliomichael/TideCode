import type { PlanReviewComment } from './planContracts'
import { formatPlanReviewRequest } from './planReview'
import { createPlanStatusMessage, parsePlanStatusMessage } from './planStatusMessages'

export function createPlanRevisionRequestMessage(relativePath: string, comments: readonly PlanReviewComment[]) {
  return createPlanStatusMessage('revision', formatPlanReviewRequest(relativePath, comments))
}

export function parsePlanRevisionRequestMessage(content: string) {
  const parsed = parsePlanStatusMessage(content)
  return parsed?.kind === 'revision' ? parsed : null
}

export function isPlanRevisionRequestMessage(content: string) {
  return parsePlanRevisionRequestMessage(content) !== null
}
