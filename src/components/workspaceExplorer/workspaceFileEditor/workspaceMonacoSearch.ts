export interface WorkspaceSearchMatch {
  end: number
  start: number
  value: string
}

export interface WorkspaceSearchOptions {
  matchCase: boolean
  regex: boolean
  wholeWord: boolean
}

function isWordCharacter(charCode: number | undefined) {
  if (charCode === undefined) {
    return false
  }

  return (
    (charCode >= 48 && charCode <= 57) ||
    (charCode >= 65 && charCode <= 90) ||
    (charCode >= 97 && charCode <= 122) ||
    charCode === 95
  )
}

function hasWholeWordBoundary(text: string, start: number, end: number) {
  const previousCharCode = start > 0 ? text.charCodeAt(start - 1) : undefined
  const nextCharCode = end < text.length ? text.charCodeAt(end) : undefined
  return !isWordCharacter(previousCharCode) && !isWordCharacter(nextCharCode)
}

export function buildWorkspaceSearchRegularExpression(
  searchValue: string,
  options: WorkspaceSearchOptions,
  global: boolean,
) {
  if (searchValue.length === 0) {
    return null
  }

  const source = options.wholeWord ? `\\b(?:${searchValue})\\b` : searchValue
  const flags = `${global ? 'g' : ''}${options.matchCase ? '' : 'i'}`

  try {
    return new RegExp(source, flags)
  } catch {
    return null
  }
}

export function findWorkspaceSearchMatches(
  text: string,
  searchValue: string,
  options: WorkspaceSearchOptions,
): WorkspaceSearchMatch[] {
  if (searchValue.length === 0) {
    return []
  }

  if (options.regex) {
    const expression = buildWorkspaceSearchRegularExpression(searchValue, options, true)
    if (!expression) {
      return []
    }

    const matches: WorkspaceSearchMatch[] = []
    for (const match of text.matchAll(expression)) {
      const matchedText = match[0] ?? ''
      const start = match.index ?? -1
      if (start < 0) {
        continue
      }

      const safeValue = matchedText.length > 0 ? matchedText : text.slice(start, start + 1)
      matches.push({
        end: start + safeValue.length,
        start,
        value: safeValue,
      })

      if (matchedText.length === 0) {
        expression.lastIndex = start + 1
      }
    }
    return matches
  }

  const normalizedText = options.matchCase ? text : text.toLowerCase()
  const normalizedSearchValue = options.matchCase ? searchValue : searchValue.toLowerCase()
  const matches: WorkspaceSearchMatch[] = []
  let searchStartIndex = 0

  while (searchStartIndex <= normalizedText.length - normalizedSearchValue.length) {
    const nextMatchIndex = normalizedText.indexOf(normalizedSearchValue, searchStartIndex)
    if (nextMatchIndex === -1) {
      break
    }

    const nextMatchEnd = nextMatchIndex + normalizedSearchValue.length
    if (options.wholeWord && !hasWholeWordBoundary(text, nextMatchIndex, nextMatchEnd)) {
      searchStartIndex = nextMatchIndex + 1
      continue
    }

    matches.push({
      end: nextMatchEnd,
      start: nextMatchIndex,
      value: text.slice(nextMatchIndex, nextMatchEnd),
    })
    searchStartIndex = nextMatchIndex + Math.max(1, normalizedSearchValue.length)
  }

  return matches
}

export function resolveWorkspaceSearchReplacement(
  match: WorkspaceSearchMatch,
  searchValue: string,
  replacementValue: string,
  options: WorkspaceSearchOptions,
) {
  if (!options.regex) {
    return replacementValue
  }

  const expression = buildWorkspaceSearchRegularExpression(searchValue, options, false)
  return expression ? match.value.replace(expression, replacementValue) : match.value
}

export function replaceAllWorkspaceSearchMatches(
  text: string,
  searchValue: string,
  replacementValue: string,
  options: WorkspaceSearchOptions,
) {
  if (options.regex) {
    const expression = buildWorkspaceSearchRegularExpression(searchValue, options, true)
    return expression ? text.replace(expression, replacementValue) : text
  }

  const matches = findWorkspaceSearchMatches(text, searchValue, options)
  let nextText = text
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index]
    nextText = `${nextText.slice(0, match.start)}${replacementValue}${nextText.slice(match.end)}`
  }
  return nextText
}
