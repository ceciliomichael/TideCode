export interface ParsedSemanticVersion {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

const SEMANTIC_VERSION_PATTERN = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/

export function parseSemanticVersion(input: string): ParsedSemanticVersion | null {
  const match = SEMANTIC_VERSION_PATTERN.exec(input.trim())
  if (!match) {
    return null
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  }
}

function comparePrereleaseIdentifiers(left: string, right: string) {
  const leftIsNumeric = /^\d+$/.test(left)
  const rightIsNumeric = /^\d+$/.test(right)

  if (leftIsNumeric && rightIsNumeric) {
    return Number(left) - Number(right)
  }

  if (leftIsNumeric !== rightIsNumeric) {
    return leftIsNumeric ? -1 : 1
  }

  return left.localeCompare(right)
}

export function compareSemanticVersions(left: string, right: string) {
  const leftVersion = parseSemanticVersion(left)
  const rightVersion = parseSemanticVersion(right)

  if (!leftVersion || !rightVersion) {
    throw new Error('Only semantic versions in x.y.z format can be compared.')
  }

  for (const key of ['major', 'minor', 'patch'] as const) {
    const difference = leftVersion[key] - rightVersion[key]
    if (difference !== 0) {
      return difference
    }
  }

  if (leftVersion.prerelease.length === 0 && rightVersion.prerelease.length === 0) {
    return 0
  }

  if (leftVersion.prerelease.length === 0) {
    return 1
  }

  if (rightVersion.prerelease.length === 0) {
    return -1
  }

  const identifierCount = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length)
  for (let index = 0; index < identifierCount; index += 1) {
    const leftIdentifier = leftVersion.prerelease[index]
    const rightIdentifier = rightVersion.prerelease[index]

    if (leftIdentifier === undefined) {
      return -1
    }

    if (rightIdentifier === undefined) {
      return 1
    }

    const difference = comparePrereleaseIdentifiers(leftIdentifier, rightIdentifier)
    if (difference !== 0) {
      return difference
    }
  }

  return 0
}

export function normalizeSemanticVersion(input: string) {
  const parsed = parseSemanticVersion(input)
  if (!parsed) {
    throw new Error(`Invalid semantic version: ${input}`)
  }

  const prerelease = parsed.prerelease.length > 0 ? `-${parsed.prerelease.join('.')}` : ''
  return `${parsed.major}.${parsed.minor}.${parsed.patch}${prerelease}`
}
