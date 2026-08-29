import type { JSONSchema7 } from '@ai-sdk/provider'

const MAX_MODEL_DESCRIPTION_LENGTH = 160
const MAX_INLINE_ENUM_VALUES = 12
const MAX_INLINE_OBJECT_FIELDS = 5
const MAX_INLINE_TYPE_DEPTH = 3
const SAFE_MEMBER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/u

export interface AgentToolCallableContract {
  description: string
  name: string
  namespace: string
  signature: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatLiteral(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return 'unknown'
  }
}

function formatType(schema: unknown, depth = 0): string {
  if (depth > MAX_INLINE_TYPE_DEPTH || !isRecord(schema)) {
    return 'unknown'
  }

  if ('const' in schema) {
    return formatLiteral(schema.const)
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const values = schema.enum.slice(0, MAX_INLINE_ENUM_VALUES).map((value) => formatLiteral(value))
    return schema.enum.length > values.length ? `${values.join(' | ')} | …` : values.join(' | ')
  }

  for (const unionKey of ['oneOf', 'anyOf']) {
    const union = schema[unionKey]
    if (Array.isArray(union) && union.length > 0) {
      return union.slice(0, 4).map((item) => formatType(item, depth + 1)).join(' | ')
    }
  }

  if (Array.isArray(schema.type)) {
    return schema.type.map((type) => String(type)).join(' | ')
  }

  switch (schema.type) {
    case 'array': {
      const itemType = formatType(schema.items, depth + 1)
      return itemType === 'string' ? 'string[]' : `Array<${itemType}>`
    }
    case 'boolean':
      return 'boolean'
    case 'integer':
    case 'number': {
      const constraints = []
      if (typeof schema.minimum === 'number') constraints.push(`>= ${schema.minimum}`)
      if (typeof schema.maximum === 'number') constraints.push(`<= ${schema.maximum}`)
      return constraints.length > 0 ? `number (${constraints.join(', ')})` : 'number'
    }
    case 'null':
      return 'null'
    case 'object': {
      if (!isRecord(schema.properties)) return 'object'
      const properties = Object.entries(schema.properties)
      if (properties.length === 0 || properties.length > MAX_INLINE_OBJECT_FIELDS) return 'object'
      const required = new Set(
        Array.isArray(schema.required)
          ? schema.required.filter((value: unknown): value is string => typeof value === 'string')
          : [],
      )
      const fields = properties.map(([propertyName, propertySchema]) => {
        const optionalMarker = required.has(propertyName) ? '' : '?'
        return `${formatPropertyName(propertyName)}${optionalMarker}: ${formatType(propertySchema, depth + 1)}`
      })
      return `{ ${fields.join('; ')} }`
    }
    case 'string':
      return 'string'
    default:
      return isRecord(schema.properties) ? 'object' : 'unknown'
  }
}

function formatMember(name: string) {
  return SAFE_MEMBER_PATTERN.test(name) ? `.${name}` : `[${formatLiteral(name)}]`
}

function formatPropertyName(name: string) {
  return SAFE_MEMBER_PATTERN.test(name) ? name : formatLiteral(name)
}

function formatSignature(name: string, inputSchema: JSONSchema7) {
  if (inputSchema.type !== 'object' && !isRecord(inputSchema.properties)) {
    return `tools${formatMember(name)}(input: ${formatType(inputSchema)}): Promise<ToolResult>`
  }

  const properties = isRecord(inputSchema.properties) ? Object.entries(inputSchema.properties) : []
  const required = new Set(
    Array.isArray(inputSchema.required)
      ? inputSchema.required.filter((value: unknown): value is string => typeof value === 'string')
      : [],
  )
  const fields = properties.map(([propertyName, propertySchema]) => {
    const optionalMarker = required.has(propertyName) ? '' : '?'
    return `${formatPropertyName(propertyName)}${optionalMarker}: ${formatType(propertySchema)}`
  })

  return `tools${formatMember(name)}({ ${fields.join(', ')} }): Promise<ToolResult>`
}

function compactDescription(description: string) {
  const compact = description.replace(/\s+/gu, ' ').trim().split(/(?<=[.!?])\s+/u, 1)[0] ?? ''
  if (compact.length <= MAX_MODEL_DESCRIPTION_LENGTH) {
    return compact
  }

  return `${compact.slice(0, MAX_MODEL_DESCRIPTION_LENGTH - 1).trimEnd()}…`
}

export function createAgentToolCallableContract(input: {
  description: string
  inputSchema: JSONSchema7
  name: string
  namespace: string
}): AgentToolCallableContract {
  return {
    description: compactDescription(input.description),
    name: input.name,
    namespace: input.namespace,
    signature: formatSignature(input.name, input.inputSchema),
  }
}
