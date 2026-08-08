import { normalizePathSeparators } from './filePathUtils'

export const PLAN_DIRECTORY = '.tidecode/plans'
export const PLAN_FILE_NAME_PATTERN = /^plan-(\d{3,})\.md$/u
const PLAN_PREVIEW_TAB_KEY_PREFIX = 'plan-preview::'
const PLAN_STATUS_FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---(?:\n|$)/u

export type PlanStatus = 'draft' | 'implementation_started'

export const DEFAULT_PLAN_STATUS: PlanStatus = 'draft'

export type PlanToolOperation = 'created' | 'updated'

export interface PlanToolResultPresentation {
  content: string
  fileName: string
  kind: 'plan'
  operation: PlanToolOperation
  planId: string
  relativePath: string
  title: string
  updatedAt: number
}

export interface PlanReviewComment {
  comment: string
  id: string
  lineEnd: number
  lineStart: number
  quote: string
}

export function normalizePlanRelativePath(relativePath: string) {
  return normalizePathSeparators(relativePath).replace(/^\.\//u, '').replace(/^\/+|\/+$/gu, '')
}

export function isPlanRelativePath(relativePath: string) {
  const normalizedPath = normalizePlanRelativePath(relativePath)
  const pathSegments = normalizedPath.split('/')
  return (
    pathSegments.length === 3 &&
    pathSegments[0] === '.tidecode' &&
    pathSegments[1] === 'plans' &&
    PLAN_FILE_NAME_PATTERN.test(pathSegments[2] ?? '')
  )
}

export function getPlanIdFromRelativePath(relativePath: string) {
  const normalizedPath = normalizePlanRelativePath(relativePath)
  const fileName = normalizedPath.split('/').at(-1) ?? ''
  const match = fileName.match(PLAN_FILE_NAME_PATTERN)
  return match?.[1] ?? null
}

export function getPlanFileName(planId: string) {
  if (!/^\d{3,}$/u.test(planId)) {
    throw new Error(`Invalid plan id: ${planId}`)
  }

  return `plan-${planId}.md`
}

export function createPlanPreviewTabKey(relativePath: string) {
  return `${PLAN_PREVIEW_TAB_KEY_PREFIX}${encodeURIComponent(normalizePlanRelativePath(relativePath))}`
}

export function isPlanPreviewTabKey(tabKey: string) {
  return tabKey.startsWith(PLAN_PREVIEW_TAB_KEY_PREFIX)
}

export function extractPlanTitle(content: string) {
  const heading = content.match(/^#{1,6}\s+(.+?)\s*#*\s*$/mu)?.[1]?.trim()
  if (heading) {
    return heading.replace(/[`*_~]/gu, '').trim()
  }

  return 'Implementation plan'
}

export function normalizePlanContent(content: string) {
  return content.replace(/\r\n?/gu, '\n').trimEnd() + '\n'
}

export function getPlanStatus(content: string): PlanStatus {
  const normalizedContent = content.replace(/\r\n?/gu, '\n')
  const frontmatterMatch = normalizedContent.match(PLAN_STATUS_FRONTMATTER_PATTERN)
  if (!frontmatterMatch) {
    return DEFAULT_PLAN_STATUS
  }

  const statusValue = frontmatterMatch[1]
    .split('\n')
    .map((line) => line.match(/^\s*status\s*:\s*([^#\s]+)\s*(?:#.*)?$/u)?.[1] ?? null)
    .find((value): value is string => value !== null)

  return statusValue === 'implementation_started' ? statusValue : DEFAULT_PLAN_STATUS
}

export function setPlanStatus(content: string, status: PlanStatus) {
  const normalizedContent = normalizePlanContent(content)
  const frontmatterMatch = normalizedContent.match(PLAN_STATUS_FRONTMATTER_PATTERN)
  if (!frontmatterMatch) {
    return normalizePlanContent(`---\nstatus: ${status}\n---\n\n${normalizedContent}`)
  }

  let hasStatusLine = false
  const metadataLines = frontmatterMatch[1].split('\n').map((line) => {
    if (!/^\s*status\s*:/u.test(line)) {
      return line
    }

    hasStatusLine = true
    return `status: ${status}`
  })

  if (!hasStatusLine) {
    metadataLines.unshift(`status: ${status}`)
  }

  const body = normalizedContent.slice(frontmatterMatch[0].length)
  return normalizePlanContent(`---\n${metadataLines.join('\n')}\n---\n${body}`)
}

export function getPlanDisplayContent(content: string) {
  const normalizedContent = content.replace(/\r\n?/gu, '\n')
  const frontmatterMatch = normalizedContent.match(PLAN_STATUS_FRONTMATTER_PATTERN)
  return frontmatterMatch ? normalizedContent.slice(frontmatterMatch[0].length).replace(/^\n+/u, '') : normalizedContent
}

function escapeRegularExpression(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

export function getPlanLineRange(content: string, selectedText: string) {
  const normalizedSelection = selectedText.replace(/\r\n?/gu, '\n').trim()
  if (normalizedSelection.length === 0) {
    return null
  }

  const normalizedContent = content.replace(/\r\n?/gu, '\n')
  const exactSelectionStart = normalizedContent.indexOf(normalizedSelection)
  let selectionStart = exactSelectionStart
  let selectionLength = normalizedSelection.length
  if (selectionStart < 0) {
    const selectionMatch = normalizedContent.match(
      new RegExp(
        normalizedSelection
          .split(/\s+/u)
          .filter((part) => part.length > 0)
          .map(escapeRegularExpression)
          .join('\\s+'),
        'u',
      ),
    )
    if (!selectionMatch || selectionMatch.index === undefined) {
      return null
    }

    selectionStart = selectionMatch.index
    selectionLength = selectionMatch[0].length
  }

  const lineStart = normalizedContent.slice(0, selectionStart).split('\n').length
  const lineEnd = normalizedContent
    .slice(0, selectionStart + selectionLength)
    .split('\n').length
  return {
    lineEnd,
    lineStart,
  }
}
