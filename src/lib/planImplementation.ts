import { normalizePlanRelativePath } from './planContracts'

const PLAN_IMPLEMENTATION_MESSAGE_PATTERN = /^<plan_(\d{6})>([\s\S]*?)<\/plan_\1>$/u

function createPlanImplementationId() {
  const randomValue = new Uint32Array(1)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(randomValue)
    return String(100000 + (randomValue[0] % 900000))
  }

  return String(100000 + Math.floor(Math.random() * 900000))
}

export function createPlanImplementationMessage(relativePath: string) {
  const planPath = normalizePlanRelativePath(relativePath)
  const planImplementationId = createPlanImplementationId()
  const message = `Implement the plan in ${planPath}.`
  return `<plan_${planImplementationId}>${message}</plan_${planImplementationId}>`
}

export function parsePlanImplementationMessage(content: string) {
  const match = content.trim().match(PLAN_IMPLEMENTATION_MESSAGE_PATTERN)
  if (!match) {
    return null
  }

  return {
    id: match[1],
    message: match[2].trim(),
  }
}

export function isPlanImplementationStatusMessage(content: string) {
  return parsePlanImplementationMessage(content) !== null
}
