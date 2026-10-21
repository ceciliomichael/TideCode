export interface MemoryDetailMetadata {
  name: string
  description: string
}

function parseScalar(rawValue: string): string | null {
  const value = rawValue.trim()
  if (value.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value)
      if (typeof parsed === 'string') {
        return parsed
      }
    } catch {
      return null
    }
    return null
  }
  if (value.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/u.test(value)) {
      return null
    }
    return value.slice(1, -1).replaceAll("''", "'")
  }
  if (/^(?:[>|{}&*!]|\[|\])/u.test(value)) {
    return null
  }
  return value
}

/** The memory format uses two single-line text fields, not general YAML. */
export function parseMemoryDetailMetadata(content: string): MemoryDetailMetadata | null {
  const normalized = content.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n')
  const frontmatter = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/u)
  if (!frontmatter) {
    return null
  }
  const fields = new Map<string, string>()
  for (const line of frontmatter[1].split('\n')) {
    if (line.trim().length === 0 || line.trimStart().startsWith('#')) {
      continue
    }
    const field = line.match(/^(name|description):\s*(.*)$/u)
    if (!field || fields.has(field[1])) {
      return null
    }
    const value = parseScalar(field[2])
    if (!value?.trim() || /[\r\n\u0000-\u001f]/u.test(value)) {
      return null
    }
    fields.set(field[1], value.trim())
  }
  const name = fields.get('name')
  const description = fields.get('description')
  if (!name || !description) {
    return null
  }
  return { name, description }
}
