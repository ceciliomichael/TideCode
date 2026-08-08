import { normalizePlanRelativePath } from './planContracts'
import { createPlanStatusMessage, parsePlanStatusMessage } from './planStatusMessages'

export function createPlanImplementationMessage(relativePath: string) {
  const planPath = normalizePlanRelativePath(relativePath)
  const message = `Implement the plan in ${planPath}.`
  return createPlanStatusMessage('implementation', message)
}

export function parsePlanImplementationMessage(content: string) {
  const parsed = parsePlanStatusMessage(content)
  return parsed?.kind === 'implementation' ? parsed : null
}

export function isPlanImplementationStatusMessage(content: string) {
  return parsePlanImplementationMessage(content) !== null
}
