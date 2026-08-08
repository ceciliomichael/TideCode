import { promises as fs } from 'node:fs'
import path from 'node:path'
import { notifyWorkspaceExplorerChange } from '../workspace/explorerNotifications'
import {
  assertWorkspaceDirectory,
  getSafeWorkspaceTargetPath,
  normalizeWorkspacePath,
} from '../workspace/paths'
import {
  extractPlanTitle,
  getPlanFileName,
  getPlanIdFromRelativePath,
  getPlanStatus,
  isPlanRelativePath,
  normalizePlanContent,
  normalizePlanRelativePath,
  PLAN_DIRECTORY,
  PLAN_FILE_NAME_PATTERN,
  setPlanStatus,
  type PlanStatus,
  type PlanToolOperation,
} from '../../src/lib/planContracts'

const MAX_PLAN_CONTENT_BYTES = 512 * 1024
const planLocks = new Map<string, Promise<void>>()

export interface StoredPlanArtifact {
  content: string
  fileName: string
  operation: PlanToolOperation
  planId: string
  relativePath: string
  title: string
  updatedAt: number
}

async function withWorkspacePlanLock<T>(workspaceRootPath: string, operation: () => Promise<T>) {
  const previousLock = planLocks.get(workspaceRootPath) ?? Promise.resolve()
  let releaseLock: () => void = () => undefined
  const currentLock = new Promise<void>((resolve) => {
    releaseLock = resolve
  })
  const lockChain = previousLock.then(() => currentLock)
  planLocks.set(workspaceRootPath, lockChain)

  try {
    await previousLock
    return await operation()
  } finally {
    releaseLock()
    if (planLocks.get(workspaceRootPath) === lockChain) {
      planLocks.delete(workspaceRootPath)
    }
  }
}

function validatePlanContent(content: string, title?: string, status: PlanStatus = 'draft') {
  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('Plan content must be a non-empty Markdown document.')
  }

  const normalizedContent = normalizePlanContent(content)
  const normalizedTitle = typeof title === 'string' ? title.replace(/\s+/gu, ' ').trim() : ''
  const titledContent =
    normalizedTitle.length === 0 || /^#\s+/mu.test(normalizedContent)
      ? normalizedContent
      : `# ${normalizedTitle}\n\n${normalizedContent}`
  const finalContent = setPlanStatus(titledContent, status)

  if (Buffer.byteLength(finalContent, 'utf8') > MAX_PLAN_CONTENT_BYTES) {
    throw new Error(`Plan content must be smaller than ${MAX_PLAN_CONTENT_BYTES / 1024} KB.`)
  }

  return finalContent
}

function resolvePlanTarget(workspaceRootPath: string, relativePath: string) {
  const normalizedRelativePath = normalizePlanRelativePath(relativePath)
  if (!isPlanRelativePath(normalizedRelativePath)) {
    throw new Error('Plan paths must match .tidecode/plans/plan-###.md.')
  }

  return getSafeWorkspaceTargetPath(workspaceRootPath, normalizedRelativePath)
}

function createStoredPlanArtifact(input: {
  content: string
  operation: PlanToolOperation
  relativePath: string
  updatedAt: number
}) {
  const normalizedPath = normalizePlanRelativePath(input.relativePath)
  const planId = getPlanIdFromRelativePath(normalizedPath)
  if (!planId) {
    throw new Error(`Invalid plan path: ${input.relativePath}`)
  }

  return {
    content: input.content,
    fileName: path.posix.basename(normalizedPath),
    operation: input.operation,
    planId,
    relativePath: normalizedPath,
    title: extractPlanTitle(input.content),
    updatedAt: input.updatedAt,
  } satisfies StoredPlanArtifact
}

export async function createPlan(input: {
  beforeMutation?: (absolutePath: string) => Promise<void>
  content: string
  title?: string
  workspaceRootPath: string
}): Promise<StoredPlanArtifact> {
  const workspaceRootPath = normalizeWorkspacePath(input.workspaceRootPath)
  await assertWorkspaceDirectory(workspaceRootPath)
  const content = validatePlanContent(input.content, input.title)

  return withWorkspacePlanLock(workspaceRootPath, async () => {
    const plansDirectoryPath = path.join(workspaceRootPath, PLAN_DIRECTORY.replaceAll('/', path.sep))
    await fs.mkdir(plansDirectoryPath, { recursive: true })

    const entries = await fs.readdir(plansDirectoryPath, { withFileTypes: true })
    const highestPlanNumber = entries.reduce((highest, entry) => {
      if (!entry.isFile()) {
        return highest
      }

      const match = entry.name.match(PLAN_FILE_NAME_PATTERN)
      const planNumber = match ? Number.parseInt(match[1], 10) : 0
      return Number.isSafeInteger(planNumber) ? Math.max(highest, planNumber) : highest
    }, 0)

    for (let planNumber = highestPlanNumber + 1; ; planNumber += 1) {
      if (!Number.isSafeInteger(planNumber)) {
        throw new Error('Unable to allocate a safe plan number.')
      }

      const planId = String(planNumber).padStart(3, '0')
      const fileName = getPlanFileName(planId)
      const relativePath = `${PLAN_DIRECTORY}/${fileName}`
      const target = resolvePlanTarget(workspaceRootPath, relativePath)
      try {
        await input.beforeMutation?.(target.absolutePath)
        await fs.writeFile(target.absolutePath, content, { encoding: 'utf8', flag: 'wx' })
        const updatedAt = Date.now()
        notifyWorkspaceExplorerChange(workspaceRootPath)
        return createStoredPlanArtifact({ content, operation: 'created', relativePath, updatedAt })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          continue
        }
        throw error
      }
    }
  })
}

export async function editPlan(input: {
  beforeMutation?: (absolutePath: string) => Promise<void>
  content: string
  relativePath: string
  workspaceRootPath: string
}): Promise<StoredPlanArtifact> {
  const workspaceRootPath = normalizeWorkspacePath(input.workspaceRootPath)
  await assertWorkspaceDirectory(workspaceRootPath)
  const target = resolvePlanTarget(workspaceRootPath, input.relativePath)
  return withWorkspacePlanLock(workspaceRootPath, async () => {
    const previousContent = await fs.readFile(target.absolutePath, 'utf8').catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Plan does not exist: ${normalizePlanRelativePath(input.relativePath)}`)
      }
      throw error
    })
    const normalizedPreviousContent = normalizePlanContent(previousContent)
    const content = validatePlanContent(input.content, undefined, getPlanStatus(normalizedPreviousContent))
    if (normalizedPreviousContent === content) {
      throw new Error(`Plan did not change: ${target.relativePath}`)
    }

    await input.beforeMutation?.(target.absolutePath)
    await fs.writeFile(target.absolutePath, content, 'utf8')
    const updatedAt = Date.now()
    notifyWorkspaceExplorerChange(workspaceRootPath)
    return createStoredPlanArtifact({
      content,
      operation: 'updated',
      relativePath: target.relativePath,
      updatedAt,
    })
  })
}
