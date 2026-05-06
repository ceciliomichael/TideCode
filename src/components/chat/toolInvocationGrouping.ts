import type { ToolInvocationTrace } from '../../types/chat'
import { isFileWriteTool } from './toolInvocationKinds'
import { getFileMutationSummaryKind } from './toolInvocationPresentation'

interface ToolInvocationSummaryCounts {
  listCount: number
  commandCount: number
  fileCount: number
  searchCount: number
  webSearchCount: number
  webFetchCount: number
  createdCount: number
  editedCount: number
  deletedCount: number
  verifiedCount: number
  exploredFileCount: number
}

function pluralize(count: number, singular: string) {
  if (count === 1) {
    return `${count} ${singular}`
  }

  if (singular === 'search') {
    return `${count} searches`
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

  if (toolName === 'webfetch') {
    return 'webFetchCount'
  }

  if (
    toolName === 'run_terminal' ||
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
    webFetchCount: 0,
    createdCount: 0,
    editedCount: 0,
    deletedCount: 0,
    verifiedCount: 0,
    exploredFileCount: 0,
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
    const mutationKind = getFileMutationSummaryKind(invocation)
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

    const classifiedBucket = classifyInvocation(invocation.toolName)
    if (classifiedBucket) {
      counts[classifiedBucket] += 1
      if (classifiedBucket === 'listCount') {
        recordMixedBucket('list')
      } else if (classifiedBucket === 'searchCount') {
        recordMixedBucket('search')
      } else if (classifiedBucket === 'webSearchCount') {
        recordMixedBucket('web-search')
      } else if (classifiedBucket === 'webFetchCount') {
        recordMixedBucket('web-fetch')
      } else if (classifiedBucket === 'commandCount') {
        recordMixedBucket('command')
      } else if (classifiedBucket === 'exploredFileCount') {
        recordMixedBucket('explored-file')
      } else if (classifiedBucket === 'fileCount') {
        recordMixedBucket('file')
      }
      continue
    }

    const label = normalizeToolLabel(invocation.toolName)
    otherToolCounts.set(label, (otherToolCounts.get(label) ?? 0) + 1)
    recordMixedBucket(`other:${label}`)
  }

  if (hasFileMutationBuckets) {
    const formatMixedBucket = (bucketKey: string, count: number) => {
      if (bucketKey === 'created') {
        return `Created ${pluralize(count, 'file')}`
      }
      if (bucketKey === 'edited') {
        return `Edited ${pluralize(count, 'file')}`
      }
      if (bucketKey === 'deleted') {
        return `Deleted ${pluralize(count, 'file')}`
      }
      if (bucketKey === 'verified') {
        return `Verified ${pluralize(count, 'file')}`
      }
      if (bucketKey === 'explored-file') {
        return `Explored ${pluralize(count, 'file')}`
      }
      if (bucketKey === 'list') {
        return `Explored ${pluralize(count, 'list')}`
      }
      if (bucketKey === 'search') {
        return pluralize(count, 'search')
      }
      if (bucketKey === 'web-search') {
        return `Ran ${pluralize(count, 'web search')}`
      }
      if (bucketKey === 'web-fetch') {
        return `Fetched ${pluralize(count, 'page')}`
      }
      if (bucketKey === 'command') {
        return `ran ${pluralize(count, 'command')}`
      }
      if (bucketKey === 'file') {
        return pluralize(count, 'file')
      }

      return pluralize(count, bucketKey.replace(/^other:/u, ''))
    }

    for (const bucketKey of mixedBucketOrder) {
      const count = mixedBucketCounts.get(bucketKey) ?? 0
      if (count > 0) {
        summaryParts.push(formatMixedBucket(bucketKey, count))
      }
    }

    return summaryParts.length > 0 ? summaryParts.join(', ') : 'Explored actions'
  }

  const hasOnlyWebFetch =
    counts.webFetchCount > 0 &&
    counts.listCount === 0 &&
    counts.commandCount === 0 &&
    counts.fileCount === 0 &&
    counts.searchCount === 0 &&
    counts.webSearchCount === 0 &&
    counts.createdCount === 0 &&
    counts.editedCount === 0 &&
    counts.deletedCount === 0 &&
    counts.verifiedCount === 0 &&
    counts.exploredFileCount === 0 &&
    otherToolCounts.size === 0

  if (hasOnlyWebFetch) {
    return `Fetched ${pluralize(counts.webFetchCount, 'page')}`
  }

  const hasOnlyWebSearch =
    counts.webSearchCount > 0 &&
    counts.listCount === 0 &&
    counts.commandCount === 0 &&
    counts.fileCount === 0 &&
    counts.searchCount === 0 &&
    counts.webFetchCount === 0 &&
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
    summaryParts.push(pluralize(counts.listCount, 'list'))
  }
  if (counts.searchCount > 0) {
    summaryParts.push(pluralize(counts.searchCount, 'search'))
  }
  if (counts.webSearchCount > 0) {
    summaryParts.push(`ran ${pluralize(counts.webSearchCount, 'web search')}`)
  }
  if (counts.commandCount > 0) {
    summaryParts.push(`ran ${pluralize(counts.commandCount, 'command')}`)
  }
  if (counts.exploredFileCount + counts.fileCount > 0) {
    summaryParts.push(pluralize(counts.exploredFileCount + counts.fileCount, 'file'))
  }
  if (counts.webFetchCount > 0) {
    summaryParts.push(`fetched ${pluralize(counts.webFetchCount, 'page')}`)
  }

  for (const [toolLabel, count] of otherToolCounts) {
    summaryParts.push(pluralize(count, toolLabel))
  }

  const summaryVerb = summaryVerbOverride ?? 'Explored'
  return summaryParts.length > 0 ? `${summaryVerb} ${summaryParts.join(', ')}` : `${summaryVerb} actions`
}
