import type { AgentToolRegistryEntry } from '../../../../tools/registry'

type Schema = Record<string, unknown>

function describeType(raw: unknown, depth = 0): string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'unknown'
  const schema = raw as Schema
  if (typeof schema.$ref === 'string') return schema.$ref.split('/').at(-1) || 'unknown'
  if (Array.isArray(schema.enum)) return schema.enum.map((item) => JSON.stringify(item)).join(' | ')
  if (schema.const !== undefined) return JSON.stringify(schema.const)
  for (const key of ['oneOf', 'anyOf'] as const) {
    if (Array.isArray(schema[key])) return (schema[key] as unknown[]).map((item) => describeType(item, depth + 1)).join(' | ')
  }
  if (Array.isArray(schema.type)) return schema.type.map((type) => describeType({ ...schema, type }, depth + 1)).join(' | ')
  if (schema.type === 'array') return `(${describeType(schema.items, depth + 1)})[]`
  if (schema.type === 'object' || schema.properties) {
    if (depth > 5) return 'object'
    const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties as Schema : {}
    const required = new Set(Array.isArray(schema.required) ? schema.required : [])
    const fields = Object.entries(properties).map(([key, value]) => `${JSON.stringify(key)}${required.has(key) ? '' : '?'}: ${describeType(value, depth + 1)}`)
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      fields.push(`[key: string]: ${describeType(schema.additionalProperties, depth + 1)}`)
    }
    return fields.length ? `{ ${fields.join('; ')} }` : 'object'
  }
  if (typeof schema.type === 'string') return schema.type === 'integer' ? 'number' : schema.type
  return 'unknown'
}

function schemaNotes(raw: unknown, prefix = '', depth = 0): string[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || depth > 5) return []
  const schema = raw as Schema
  const notes: string[] = []
  const details = ['description', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'pattern', 'format', 'minItems', 'maxItems', 'default', 'multipleOf']
    .filter((key) => schema[key] !== undefined)
    .map((key) => key === 'description' ? String(schema[key]).trim() : `${key}: ${JSON.stringify(schema[key])}`)
  if (prefix && details.length) notes.push(`- \`${prefix}\`: ${details.join('; ')}`)
  if (schema.items) notes.push(...schemaNotes(schema.items, prefix ? `${prefix}[]` : '[]', depth + 1))
  if (schema.properties && typeof schema.properties === 'object') {
    for (const [key, value] of Object.entries(schema.properties as Schema)) {
      notes.push(...schemaNotes(value, prefix ? `${prefix}.${key}` : key, depth + 1))
    }
  }
  return notes
}

export function getAvailableApi(tool: AgentToolRegistryEntry, name: string): string {
  const schema = tool.inputSchema as Schema
  const returnType = tool.namespace === 'mcp' ? 'McpValue' : 'ToolResult'
  const description = tool.description.trim()
  const header = description.startsWith(`# ${name}`) ? description : `# ${name}\n\n${description}`
  const notes = schemaNotes(schema)
  const needsFallback = (value: unknown, depth = 0): boolean => {
    if (!value || typeof value !== 'object' || depth > 15) return depth > 15
    if (Array.isArray(value)) return value.some((part) => needsFallback(part, depth + 1))
    const object = value as Schema
    if (['allOf', 'not', 'if', 'then', 'else', '$ref', '$defs', 'definitions', 'dependentRequired', 'dependentSchemas', 'propertyNames', 'patternProperties', 'contains', 'unevaluatedProperties', 'minProperties', 'maxProperties', 'uniqueItems', 'prefixItems'].some((key) => object[key] !== undefined)) return true
    return Object.values(object).some((part) => needsFallback(part, depth + 1))
  }
  const complexSchema = needsFallback(schema)
  const fallback = complexSchema
    ? `\n\n## Complete input schema\n\nThis JSON Schema is authoritative for required fields, alternatives, references, and validation constraints.\n\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\`` : ''
  const simpleNotes = !complexSchema && notes.length ? `\n\n## Parameters\n\n${notes.join('\n')}` : ''
  return `${header}\n\n## Call\n\n\`\`\`ts\nawait ${name}(input: ${describeType(schema)}): Promise<${returnType}>\n\`\`\`${simpleNotes}${fallback}`
}
