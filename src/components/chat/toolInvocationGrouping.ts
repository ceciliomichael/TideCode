import type { ToolInvocationTrace } from '../../types/chat'
import { buildKanbanToolInvocationGroupSummary } from './kanbanToolInvocationGrouping'
import { isKanbanTool } from './kanbanToolInvocationKinds'
import { isFileWriteTool } from './toolInvocationKinds'
import { getFileMutationSummaryKind, resolveToolInvocationForPresentation } from './toolInvocationPresentation'

interface ToolInvocationSummaryCounts {
  listCount: number
  commandCount: number
  fileCount: number
  searchCount: number
  webSearchCount: number
  createdCount: number
  editedCount: number
  deletedCount: number
  verifiedCount: number
  exploredFileCount: number
  kanbanCount: number
}

function pluralize(count: number, singular: string) {
  if (count === 1) {
    return `${count} ${singular}`
  }

  if (singular === 'search') {
    return `${count} searches`
  }

  if (singular === 'web search') {
    return `${count} web searches`
  }

  return `${count} ${singular}s`
}

function classifyInvocation(toolName: string): keyof ToolInvocationSummaryCounts | null {
  if (toolName === 'list') {
    return 'listCount'
  }

  if (toolName === 'glob' || toolName === 'grep' || toolName === 'search_query' || toolName === 'image_query') {
    return 'searchCount'
  }

  if (toolName === 'web_search') {
    return 'webSearchCount'
  }

  if (
    toolName === 'execute_terminal' ||
    toolName === 'get_terminal_output' ||
    toolName === 'exec_command' ||
    toolName === 'write_stdin' ||
    toolName.includes('terminal')
  ) {
    return 'commandCount'
  }

  if (toolName === 'read') {
    return 'exploredFileCount'
  }

  if (isFileWriteTool(toolName)) {
    return 'fileCount'
  }

  return null
}

function normalizeToolLabel(toolName: string) {
  return toolName.replace(/_/g, ' ')
}

function capitalizeLeadingWord(value: string) {
  return value.length > 0 ? `${value[0].toUpperCase()}${value.slice(1)}` : value
}

function getMixedBucketPriority(bucketKey: string) {
  if (bucketKey === 'created') {
    return 0
  }
  if (bucketKey === 'edited') {
    return 1
  }
  if (bucketKey === 'deleted') {
    return 2
  }
  if (bucketKey === 'verified') {
    return 3
  }
  if (bucketKey === 'explored-file') {
    return 4
  }
  if (bucketKey === 'file') {
    return 5
  }
  if (bucketKey === 'list') {
    return 6
  }
  if (bucketKey === 'search') {
    return 7
  }
  if (bucketKey === 'command') {
    return 8
  }
  if (bucketKey === 'kanban') {
    return 9
  }
  if (bucketKey === 'web-search') {
    return 10
  }

  return 11
}

function formatMixedSummaryParts(
  mixedBucketOrder: readonly string[],
  mixedBucketCounts: ReadonlyMap<string, number>,
  formatBucket: (bucketKey: string, count: number) => string,
) {
  const orderedBuckets = mixedBucketOrder
    .map((bucketKey, index) => ({
      bucketKey,
      index,
    }))
    .sort((left, right) => getMixedBucketPriority(left.bucketKey) - getMixedBucketPriority(right.bucketKey) || left.index - right.index)

  const summaryParts = orderedBuckets
    .map(({ bucketKey }) => {
      const count = mixedBucketCounts.get(bucketKey) ?? 0
      return count > 0 ? formatBucket(bucketKey, count) : null
    })
    .filter((part): part is string => part !== null)

  if (summaryParts.length > 0) {
    summaryParts[0] = capitalizeLeadingWord(summaryParts[0])
  }

  return summaryParts
}

export function buildToolInvocationGroupSummary(
  invocations: readonly ToolInvocationTrace[],
  summaryVerbOverride?: 'Exploring' | 'Explored' | 'Creating' | 'Created' | 'Editing' | 'Edited',
) {
  const hasActiveInvocation = invocations.some(
    (invocation) => invocation.state === 'running' || invocation.decisionRequest !== undefined,
  )
  if (summaryVerbOverride === 'Exploring' || (summaryVerbOverride === undefined && hasActiveInvocation)) {
    return 'Exploring'
  }

  if (
    summaryVerbOverride === 'Creating' ||
    summaryVerbOverride === 'Created' ||
    summaryVerbOverride === 'Editing' ||
    summaryVerbOverride === 'Edited'
  ) {
    const summaryVerb = summaryVerbOverride
    return `${summaryVerb} ${pluralize(invocations.length, 'file')}`
  }
  const counts: ToolInvocationSummaryCounts = {
    listCount: 0,
    commandCount: 0,
    fileCount: 0,
    searchCount: 0,
    webSearchCount: 0,
    createdCount: 0,
    editedCount: 0,
    deletedCount: 0,
    verifiedCount: 0,
    exploredFileCount: 0,
    kanbanCount: 0,
  }
  const otherToolCounts = new Map<string, number>()
  let hasFileMutationBuckets = false
  const mixedBucketOrder: string[] = []
  const mixedBucketCounts = new Map<string, number>()
  const summaryParts: string[] = []

  const recordMixedBucket = (bucketKey: string) => {
    if (!mixedBucketCounts.has(bucketKey)) {
      mixedBucketOrder.push(bucketKey)
    }

    mixedBucketCounts.set(bucketKey, (mixedBucketCounts.get(bucketKey) ?? 0) + 1)
  }

  for (const invocation of invocations) {
    const displayInvocation = resolveToolInvocationForPresentation(invocation)
    const mutationKind = getFileMutationSummaryKind(displayInvocation)
    if (mutationKind) {
      hasFileMutationBuckets = true
      if (mutationKind === 'created') {
        counts.createdCount += 1
      } else if (mutationKind === 'edited') {
        counts.editedCount += 1
      } else if (mutationKind === 'deleted') {
        counts.deletedCount += 1
      } else if (mutationKind === 'verified') {
        counts.verifiedCount += 1
      }
      recordMixedBucket(mutationKind)
      continue
    }

    if (isKanbanTool(displayInvocation.toolName)) {
      counts.kanbanCount += 1
      recordMixedBucket('kanban')
      continue
    }

    const classifiedBucket = classifyInvocation(displayInvocation.toolName)
    if (classifiedBucket) {
      counts[classifiedBucket] += 1
      if (classifiedBucket === 'listCount') {
        recordMixedBucket('list')
      } else if (classifiedBucket === 'searchCount') {
        recordMixedBucket('search')
      } else if (classifiedBucket === 'webSearchCount') {
        recordMixedBucket('web-search')
      } else if (classifiedBucket === 'commandCount') {
        recordMixedBucket('command')
      } else if (classifiedBucket === 'exploredFileCount') {
        recordMixedBucket('explored-file')
      } else if (classifiedBucket === 'fileCount') {
        recordMixedBucket('file')
      }
      continue
    }

    const label = normalizeToolLabel(displayInvocation.toolName)
    otherToolCounts.set(label, (otherToolCounts.get(label) ?? 0) + 1)
    recordMixedBucket(`other:${label}`)
  }

  if (hasFileMutationBuckets) {
    const formatMixedBucket = (bucketKey: string, count: number) => {
      if (bucketKey === 'created') {
        return `created ${pluralize(count, 'file')}`
      }
      if (bucketKey === 'edited') {
        return `edited ${pluralize(count, 'file')}`
      }
      if (bucketKey === 'deleted') {
        return `deleted ${pluralize(count, 'file')}`
      }
      if (bucketKey === 'verified') {
        return `verified ${pluralize(count, 'file')}`
      }
      if (bucketKey === 'explored-file') {
        return `explored ${pluralize(count, 'file')}`
      }
      if (bucketKey === 'list') {
        return `explored ${pluralize(count, 'list')}`
      }
      if (bucketKey === 'search') {
        return `ran ${pluralize(count, 'search')}`
      }
      if (bucketKey === 'web-search') {
        return `ran ${pluralize(count, 'web search')}`
      }
      if (bucketKey === 'command') {
        return `ran ${pluralize(count, 'command')}`
      }
      if (bucketKey === 'file') {
        return `explored ${pluralize(count, 'file')}`
      }
      if (bucketKey === 'kanban') {
        return buildKanbanToolInvocationGroupSummary(count)
      }

      return pluralize(count, bucketKey.replace(/^other:/u, ''))
    }

    summaryParts.push(...formatMixedSummaryParts(mixedBucketOrder, mixedBucketCounts, formatMixedBucket))

    return summaryParts.length > 0 ? summaryParts.join(', ') : 'Explored actions'
  }

  const hasOnlyWebSearch =
    counts.webSearchCount > 0 &&
    counts.listCount === 0 &&
    counts.commandCount === 0 &&
    counts.fileCount === 0 &&
    counts.kanbanCount === 0 &&
    counts.searchCount === 0 &&
    counts.createdCount === 0 &&
    counts.editedCount === 0 &&
    counts.deletedCount === 0 &&
    counts.verifiedCount === 0 &&
    counts.exploredFileCount === 0 &&
    otherToolCounts.size === 0

  if (hasOnlyWebSearch) {
    return `Ran ${pluralize(counts.webSearchCount, 'web search')}`
  }

  if (counts.listCount > 0) {
    summaryParts.push(`explored ${pluralize(counts.listCount, 'list')}`)
  }
  if (counts.searchCount > 0) {
    summaryParts.push(`ran ${pluralize(counts.searchCount, 'search')}`)
  }
  if (counts.webSearchCount > 0) {
    summaryParts.push(`ran ${pluralize(counts.webSearchCount, 'web search')}`)
  }
  if (counts.commandCount > 0) {
    summaryParts.push(`ran ${pluralize(counts.commandCount, 'command')}`)
  }
  if (counts.exploredFileCount + counts.fileCount > 0) {
    summaryParts.push(`explored ${pluralize(counts.exploredFileCount + counts.fileCount, 'file')}`)
  }
  if (counts.kanbanCount > 0) {
    summaryParts.push(buildKanbanToolInvocationGroupSummary(counts.kanbanCount))
  }

  for (const [toolLabel, count] of otherToolCounts) {
    summaryParts.push(`explored ${pluralize(count, toolLabel)}`)
  }

  if (summaryParts.length === 1) {
    summaryParts[0] = capitalizeLeadingWord(summaryParts[0])
  } else if (summaryParts.length > 1) {
    summaryParts[0] = capitalizeLeadingWord(summaryParts[0])
  }

  return summaryParts.length > 0 ? summaryParts.join(', ') : 'Explored actions'
}
