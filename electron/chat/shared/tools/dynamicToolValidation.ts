import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv'
import Ajv2019 from 'ajv/dist/2019.js'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

export interface JsonSchemaValidationIssue {
  message: string
  path: string
}

export interface CompiledJsonSchemaValidator {
  validate: (value: unknown) => JsonSchemaValidationIssue[]
}

export type JsonSchemaCompilationResult =
  | { success: true; validator: CompiledJsonSchemaValidator }
  | { error: string; success: false }

const MAX_SCHEMA_DEPTH = 256
const MAX_SCHEMA_BYTES = 2 * 1024 * 1024

function configureAjv<T extends Ajv | Ajv2019 | Ajv2020>(ajv: T): T {
  addFormats(ajv)
  return ajv
}

const draft7Validator = configureAjv(
  new Ajv({
    allErrors: true,
    allowMatchingProperties: true,
    allowUnionTypes: true,
    strictSchema: true,
    strictTuples: false,
    strictTypes: false,
    validateFormats: true,
  }),
)

const draft2019Validator = configureAjv(
  new Ajv2019({
    allErrors: true,
    allowMatchingProperties: true,
    allowUnionTypes: true,
    strictSchema: true,
    strictTuples: false,
    strictTypes: false,
    validateFormats: true,
  }),
)

const draft2020Validator = configureAjv(
  new Ajv2020({
    allErrors: true,
    allowMatchingProperties: true,
    allowUnionTypes: true,
    strictSchema: true,
    strictTuples: false,
    strictTypes: false,
    validateFormats: true,
  }),
)

function decodeJsonPointerSegment(value: string) {
  return value.replaceAll('~1', '/').replaceAll('~0', '~')
}

function formatPropertyPath(path: string, key: string) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`
}

function formatInstancePath(instancePath: string) {
  if (!instancePath) {
    return '$'
  }

  return instancePath
    .split('/')
    .slice(1)
    .map(decodeJsonPointerSegment)
    .reduce(
      (path, segment) => (/^\d+$/u.test(segment) ? `${path}[${segment}]` : formatPropertyPath(path, segment)),
      '$',
    )
}

function toValidationIssue(error: ErrorObject): JsonSchemaValidationIssue {
  let path = formatInstancePath(error.instancePath)
  let message = error.message ?? `failed ${error.keyword} validation`

  if (error.keyword === 'required') {
    const missingProperty = typeof error.params.missingProperty === 'string' ? error.params.missingProperty : null
    if (missingProperty) {
      path = formatPropertyPath(path, missingProperty)
    }
    message = 'is required'
  } else if (error.keyword === 'additionalProperties') {
    const additionalProperty =
      typeof error.params.additionalProperty === 'string' ? error.params.additionalProperty : null
    if (additionalProperty) {
      path = formatPropertyPath(path, additionalProperty)
    }
    message = 'is not allowed'
  }

  return { message, path }
}

function selectMostRelevantUnionBranches(errors: readonly ErrorObject[]) {
  const excludedErrors = new Set<ErrorObject>()
  const unionErrors = errors
    .filter((error) => error.keyword === 'oneOf' || error.keyword === 'anyOf')
    .sort((left, right) => right.schemaPath.length - left.schemaPath.length)

  for (const unionError of unionErrors) {
    const branchPrefix = `${unionError.schemaPath}/`
    const errorsByBranch = new Map<string, ErrorObject[]>()
    for (const error of errors) {
      if (error === unionError || !error.schemaPath.startsWith(branchPrefix)) continue
      const branch = error.schemaPath.slice(branchPrefix.length).split('/')[0]
      if (!/^\d+$/u.test(branch)) continue
      const branchErrors = errorsByBranch.get(branch) ?? []
      branchErrors.push(error)
      errorsByBranch.set(branch, branchErrors)
    }

    if (errorsByBranch.size === 0) continue
    const selectedBranch = Array.from(errorsByBranch.entries()).sort((left, right) => {
      const activeLeftErrors = left[1].filter((error) => !excludedErrors.has(error)).length
      const activeRightErrors = right[1].filter((error) => !excludedErrors.has(error)).length
      return activeLeftErrors - activeRightErrors || Number(left[0]) - Number(right[0])
    })[0]?.[0]

    for (const [branch, branchErrors] of errorsByBranch.entries()) {
      if (branch === selectedBranch) continue
      branchErrors.forEach((error) => excludedErrors.add(error))
    }
  }

  return errors.filter((error) => !excludedErrors.has(error))
}

function measureSchema(schema: Record<string, unknown>) {
  let serialized: string
  try {
    serialized = JSON.stringify(schema)
  } catch {
    return {
      error: 'Schema must be JSON-serializable.',
      success: false as const,
    }
  }

  if (Buffer.byteLength(serialized, 'utf8') > MAX_SCHEMA_BYTES) {
    return {
      error: `Schema exceeds the ${MAX_SCHEMA_BYTES}-byte compilation limit.`,
      success: false as const,
    }
  }

  const pending: Array<{ depth: number; value: unknown }> = [{ depth: 0, value: schema }]
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) continue
    if (current.depth > MAX_SCHEMA_DEPTH) {
      return {
        error: `Schema exceeds the maximum supported depth of ${MAX_SCHEMA_DEPTH}.`,
        success: false as const,
      }
    }

    if (Array.isArray(current.value)) {
      for (const item of current.value) {
        pending.push({ depth: current.depth + 1, value: item })
      }
      continue
    }

    if (typeof current.value === 'object' && current.value !== null) {
      for (const item of Object.values(current.value)) {
        pending.push({ depth: current.depth + 1, value: item })
      }
    }
  }

  return { success: true as const }
}

function selectValidator(schema: Record<string, unknown>) {
  const dialect = typeof schema.$schema === 'string' ? schema.$schema.toLowerCase() : ''
  if (!dialect || dialect.includes('2020-12')) {
    return draft2020Validator
  }
  if (dialect.includes('2019-09')) {
    return draft2019Validator
  }
  if (dialect.includes('draft-07')) {
    return draft7Validator
  }
  throw new Error(`Unsupported JSON Schema dialect: ${schema.$schema}`)
}

function createValidator(validateFunction: ValidateFunction<unknown>): CompiledJsonSchemaValidator {
  return {
    validate: (value) => {
      if (validateFunction(value)) {
        return []
      }
      return selectMostRelevantUnionBranches(validateFunction.errors ?? []).slice(0, 25).map(toValidationIssue)
    },
  }
}

export function compileJsonSchema(schema: Record<string, unknown>): JsonSchemaCompilationResult {
  const measurement = measureSchema(schema)
  if (!measurement.success) {
    return measurement
  }

  try {
    const validateFunction = selectValidator(schema).compile<unknown>(schema)
    return { success: true, validator: createValidator(validateFunction) }
  } catch (error) {
    const message =
      error instanceof Error && error.message.trim().length > 0 ? error.message : 'Schema compilation failed.'
    return { error: message, success: false }
  }
}

export function getFirstValidationError(issues: readonly JsonSchemaValidationIssue[]) {
  const issue = issues[0]
  return issue ? `${issue.path} ${issue.message}.` : null
}
