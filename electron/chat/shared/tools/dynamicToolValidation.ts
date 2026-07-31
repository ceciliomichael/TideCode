import { isRecord } from './dynamicToolContracts'

export interface JsonSchemaValidationIssue {
  message: string
  path: string
}

function formatPath(path: string, key: string | number) {
  if (typeof key === 'number') {
    return `${path}[${key}]`
  }

  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`
}

function typeMatches(value: unknown, type: string) {
  switch (type) {
    case 'array':
      return Array.isArray(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'null':
      return value === null
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    case 'object':
      return isRecord(value)
    case 'string':
      return typeof value === 'string'
    default:
      return true
  }
}

function readSchemaTypes(schema: Record<string, unknown>) {
  if (typeof schema.type === 'string') {
    return [schema.type]
  }

  if (Array.isArray(schema.type)) {
    return schema.type.filter((value): value is string => typeof value === 'string')
  }

  return []
}

function validateAgainstSchema(
  value: unknown,
  schema: Record<string, unknown>,
  path: string,
  issues: JsonSchemaValidationIssue[],
  depth: number,
) {
  if (issues.length >= 25 || depth > 32) {
    return
  }

  if (Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf) {
      if (isRecord(branch)) {
        validateAgainstSchema(value, branch, path, issues, depth + 1)
      }
    }
  }

  for (const keyword of ['anyOf', 'oneOf'] as const) {
    const branches = schema[keyword]
    if (!Array.isArray(branches)) {
      continue
    }

    const branchMatches = branches.some((branch) => {
      if (!isRecord(branch)) {
        return true
      }

      const branchIssues: JsonSchemaValidationIssue[] = []
      validateAgainstSchema(value, branch, path, branchIssues, depth + 1)
      return branchIssues.length === 0
    })
    if (!branchMatches) {
      issues.push({ message: `must match one of the allowed schemas`, path })
      return
    }
  }

  if ('const' in schema && !Object.is(value, schema.const)) {
    issues.push({ message: `must equal ${JSON.stringify(schema.const)}`, path })
    return
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    issues.push({ message: `must be one of ${schema.enum.map((candidate) => JSON.stringify(candidate)).join(', ')}`, path })
    return
  }

  const schemaTypes = readSchemaTypes(schema)
  if (schemaTypes.length > 0 && !schemaTypes.some((type) => typeMatches(value, type))) {
    issues.push({ message: `must be ${schemaTypes.join(' or ')}`, path })
    return
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      issues.push({ message: `must contain at least ${schema.minLength} characters`, path })
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      issues.push({ message: `must contain at most ${schema.maxLength} characters`, path })
    }
    if (typeof schema.pattern === 'string') {
      try {
        if (!new RegExp(schema.pattern, 'u').test(value)) {
          issues.push({ message: `must match ${JSON.stringify(schema.pattern)}`, path })
        }
      } catch {
        // An invalid provider pattern should not make every invocation unusable.
      }
    }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      issues.push({ message: `must be greater than or equal to ${schema.minimum}`, path })
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      issues.push({ message: `must be less than or equal to ${schema.maximum}`, path })
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      issues.push({ message: `must contain at least ${schema.minItems} items`, path })
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      issues.push({ message: `must contain at most ${schema.maxItems} items`, path })
    }
    if (isRecord(schema.items)) {
      value.forEach((item, index) => validateAgainstSchema(item, schema.items as Record<string, unknown>, formatPath(path, index), issues, depth + 1))
    }
  }

  if (!isRecord(value)) {
    return
  }

  const properties = isRecord(schema.properties) ? schema.properties : {}
  const required = Array.isArray(schema.required)
    ? schema.required.filter((key): key is string => typeof key === 'string')
    : []

  for (const key of required) {
    if (!(key in value)) {
      issues.push({ message: 'is required', path: formatPath(path, key) })
    }
  }

  for (const [key, propertyValue] of Object.entries(value)) {
    const propertySchema = properties[key]
    if (isRecord(propertySchema)) {
      validateAgainstSchema(propertyValue, propertySchema, formatPath(path, key), issues, depth + 1)
      continue
    }

    if (schema.additionalProperties === false) {
      issues.push({ message: 'is not allowed', path: formatPath(path, key) })
    } else if (isRecord(schema.additionalProperties)) {
      validateAgainstSchema(propertyValue, schema.additionalProperties, formatPath(path, key), issues, depth + 1)
    }
  }
}

export function validateJsonSchema(value: unknown, schema: Record<string, unknown>) {
  const issues: JsonSchemaValidationIssue[] = []
  validateAgainstSchema(value, schema, '$', issues, 0)
  return issues
}

export function getFirstValidationError(issues: readonly JsonSchemaValidationIssue[]) {
  const issue = issues[0]
  return issue ? `${issue.path} ${issue.message}.` : null
}
