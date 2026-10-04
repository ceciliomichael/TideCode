import type { FolderPickerEntry } from '../../types/chat'
import type { FolderPickerRoot } from '../../types/chat'

export interface FolderPickerNavigationState {
  history: string[]
  index: number
}

export function advanceFolderPickerNavigation(
  state: FolderPickerNavigationState,
  folderPath: string,
): FolderPickerNavigationState {
  if (state.history[state.index] === folderPath) {
    return state
  }

  return {
    history: [...state.history.slice(0, state.index + 1), folderPath],
    index: state.index + 1,
  }
}

export function filterFolderPickerEntries(
  entries: readonly FolderPickerEntry[],
  searchQuery: string,
) {
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase()
  if (!normalizedQuery) {
    return entries
  }

  return entries.filter((entry) => entry.name.toLocaleLowerCase().includes(normalizedQuery))
}

function compactFolderSearchValue(value: string) {
  return value.toLocaleLowerCase().replace(/[.\s_-]+/gu, '')
}

function getSubsequenceGapScore(value: string, query: string) {
  let queryIndex = 0
  let previousMatchIndex = -1
  let gapScore = 0

  for (let valueIndex = 0; valueIndex < value.length && queryIndex < query.length; valueIndex += 1) {
    if (value[valueIndex] !== query[queryIndex]) {
      continue
    }

    if (previousMatchIndex >= 0) {
      gapScore += valueIndex - previousMatchIndex - 1
    }
    previousMatchIndex = valueIndex
    queryIndex += 1
  }

  return queryIndex === query.length ? gapScore : null
}

function getEditDistance(left: string, right: string) {
  if (left === right) {
    return 0
  }
  if (left.length === 0) {
    return right.length
  }
  if (right.length === 0) {
    return left.length
  }

  let previousRow = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const currentRow = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1
      currentRow[rightIndex] = Math.min(
        currentRow[rightIndex - 1] + 1,
        previousRow[rightIndex] + 1,
        previousRow[rightIndex - 1] + substitutionCost,
      )
    }
    previousRow = currentRow
  }

  return previousRow[right.length]
}

function scoreFolderPickerSuggestion(name: string, rawQuery: string) {
  const query = rawQuery.trim().toLocaleLowerCase()
  if (!query) {
    return null
  }

  const normalizedName = name.toLocaleLowerCase()
  const compactQuery = compactFolderSearchValue(query)
  const compactName = compactFolderSearchValue(normalizedName)

  if (normalizedName === query) {
    return [0, 0, normalizedName.length] as const
  }
  if (normalizedName.startsWith(query)) {
    return [1, 0, normalizedName.length] as const
  }
  if (compactQuery && compactName.startsWith(compactQuery)) {
    return [2, 0, normalizedName.length] as const
  }
  if (normalizedName.includes(query)) {
    return [3, normalizedName.indexOf(query), normalizedName.length] as const
  }
  if (compactQuery && compactName.includes(compactQuery)) {
    return [4, compactName.indexOf(compactQuery), normalizedName.length] as const
  }

  const subsequenceGapScore = compactQuery
    ? getSubsequenceGapScore(compactName, compactQuery)
    : null
  if (subsequenceGapScore !== null) {
    return [5, subsequenceGapScore, normalizedName.length] as const
  }

  if (!compactQuery) {
    return null
  }

  const comparisonLength = Math.min(compactName.length, compactQuery.length)
  const prefixDistance = getEditDistance(
    compactName.slice(0, comparisonLength),
    compactQuery.slice(0, comparisonLength),
  )
  const fullDistance = getEditDistance(compactName, compactQuery)
  const editDistance = Math.min(prefixDistance, fullDistance)
  const maximumDistance = compactQuery.length >= 5 ? 2 : 1
  if (editDistance <= maximumDistance) {
    return [6, editDistance, normalizedName.length] as const
  }

  return null
}

export function getFolderPickerSuggestions(
  entries: readonly FolderPickerEntry[],
  query: string,
  limit = 8,
) {
  return entries
    .flatMap((entry) => {
      const score = scoreFolderPickerSuggestion(entry.name, query)
      return score ? [{ entry, score }] : []
    })
    .sort((left, right) => {
      for (let index = 0; index < left.score.length; index += 1) {
        const delta = left.score[index] - right.score[index]
        if (delta !== 0) {
          return delta
        }
      }
      return left.entry.name.localeCompare(right.entry.name, undefined, { sensitivity: 'base' })
    })
    .slice(0, limit)
    .map((candidate) => candidate.entry)
}

export function resolveFolderPickerInputPath(
  entries: readonly FolderPickerEntry[],
  currentDirectoryName: string,
  currentDirectoryPath: string,
  inputValue: string,
) {
  const normalizedInput = inputValue.trim().toLocaleLowerCase()
  if (!normalizedInput) {
    return null
  }

  if (currentDirectoryName.trim().toLocaleLowerCase() === normalizedInput) {
    return currentDirectoryPath
  }

  return entries.find((entry) => entry.name.toLocaleLowerCase() === normalizedInput)?.path ?? null
}

function normalizeFolderPickerPath(value: string) {
  const normalized = value
    .trim()
    .replace(/\\/gu, '/')
    .replace(/\/+$/gu, '')
    .toLocaleLowerCase()

  return normalized || '/'
}

export function areFolderPickerPathsEqual(left: string, right: string) {
  return normalizeFolderPickerPath(left) === normalizeFolderPickerPath(right)
}

export function findActiveFolderPickerRootPath(
  roots: readonly FolderPickerRoot[],
  currentDirectoryPath: string | null | undefined,
) {
  if (!currentDirectoryPath) {
    return null
  }

  const normalizedCurrentPath = normalizeFolderPickerPath(currentDirectoryPath)
  let activeRoot: FolderPickerRoot | null = null
  let activeRootLength = -1

  for (const root of roots) {
    const normalizedRootPath = normalizeFolderPickerPath(root.path)
    const isWithinRoot = normalizedCurrentPath === normalizedRootPath
      || normalizedCurrentPath.startsWith(normalizedRootPath === '/'
        ? '/'
        : normalizedRootPath + '/')

    if (!isWithinRoot || normalizedRootPath.length <= activeRootLength) {
      continue
    }

    activeRoot = root
    activeRootLength = normalizedRootPath.length
  }

  return activeRoot?.path ?? null
}
