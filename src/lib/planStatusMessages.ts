export type PlanStatusMessageKind = 'implementation' | 'revision'

export const PLAN_HANDOFF_SUCCESS_LABEL = 'Handoff successful'

export interface ParsedPlanStatusMessage {
  id: string
  kind: PlanStatusMessageKind
  message: string
}

const PLAN_IMPLEMENTATION_MESSAGE_PATTERN = /^<plan_(\d{6})>([\s\S]*?)<\/plan_\1>$/u
const PLAN_REVISION_MESSAGE_PATTERN = /^<plan_revision_(\d{6})>([\s\S]*?)<\/plan_revision_\1>$/u

function createPlanStatusMessageId() {
  const randomValue = new Uint32Array(1)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(randomValue)
    return String(100000 + (randomValue[0] % 900000))
  }

  return String(100000 + Math.floor(Math.random() * 900000))
}

export function createPlanStatusMessage(kind: PlanStatusMessageKind, message: string) {
  const id = createPlanStatusMessageId()
  const prefix = kind === 'revision' ? 'plan_revision' : 'plan'
  return `<${prefix}_${id}>${message}</${prefix}_${id}>`
}

export function parsePlanStatusMessage(content: string): ParsedPlanStatusMessage | null {
  const trimmedContent = content.trim()
  const revisionMatch = trimmedContent.match(PLAN_REVISION_MESSAGE_PATTERN)
  if (revisionMatch) {
    return {
      id: revisionMatch[1],
      kind: 'revision',
      message: revisionMatch[2].trim(),
    }
  }

  const implementationMatch = trimmedContent.match(PLAN_IMPLEMENTATION_MESSAGE_PATTERN)
  if (implementationMatch) {
    return {
      id: implementationMatch[1],
      kind: 'implementation',
      message: implementationMatch[2].trim(),
    }
  }

  return null
}

export function isPlanStatusMessage(content: string) {
  return parsePlanStatusMessage(content) !== null
}
