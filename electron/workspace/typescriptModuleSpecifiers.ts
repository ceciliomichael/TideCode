const MODULE_SPECIFIER_PATTERNS = [
  /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gu,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
  /\bimport\s+[^=;]+?=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
/\/\/\/\s*<reference\s+types=['"]([^'"]+)['"]/gu,
]

const REFERENCE_PATH_PATTERN = /\/\/\/\s*<reference\s+path=['"]([^'"]+)['"]/gu

export function extractWorkspaceTypeScriptReferencePaths(content: string) {
  const paths = new Set<string>()
  REFERENCE_PATH_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = REFERENCE_PATH_PATTERN.exec(content)) !== null) {
    const referencePath = match[1]?.trim()
    if (referencePath) {
      paths.add(referencePath)
    }
    if (match[0].length === 0) {
      REFERENCE_PATH_PATTERN.lastIndex += 1
    }
  }
  return Array.from(paths)
}

export interface WorkspacePackageSpecifierParts {
  packageName: string
  subpath: string
}

export function extractWorkspaceTypeScriptModuleSpecifiers(content: string) {
  const specifiers = new Set<string>()
  for (const pattern of MODULE_SPECIFIER_PATTERNS) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(content)) !== null) {
      const specifier = match[1]?.trim()
      if (specifier) {
        specifiers.add(specifier)
      }
      if (match[0].length === 0) {
        pattern.lastIndex += 1
      }
    }
  }
  return Array.from(specifiers)
}

export function splitWorkspacePackageSpecifier(specifier: string): WorkspacePackageSpecifierParts | null {
  if (
    !specifier ||
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    /^[a-z]+:/iu.test(specifier)
  ) {
    return null
  }

  const segments = specifier.split('/').filter(Boolean)
  if (segments.length === 0) {
    return null
  }

  if (specifier.startsWith('@')) {
    if (segments.length < 2) return null
    return {
      packageName: segments.slice(0, 2).join('/'),
      subpath: segments.slice(2).join('/'),
    }
  }

  return {
    packageName: segments[0],
    subpath: segments.slice(1).join('/'),
  }
}

export function getWorkspacePackageName(specifier: string) {
  return splitWorkspacePackageSpecifier(specifier)?.packageName ?? null
}

export function toWorkspaceTypesPackageSpecifier(specifier: string) {
  const parts = splitWorkspacePackageSpecifier(specifier)
  if (!parts || parts.packageName.startsWith('@types/')) {
    return specifier
  }

  const typesPackageName = parts.packageName.startsWith('@')
    ? (() => {
        const [scope, name] = parts.packageName.slice(1).split('/')
        return scope && name ? '@types/' + scope + '__' + name : null
      })()
    : '@types/' + parts.packageName

  if (!typesPackageName) {
    return specifier
  }
  return parts.subpath ? typesPackageName + '/' + parts.subpath : typesPackageName
}
