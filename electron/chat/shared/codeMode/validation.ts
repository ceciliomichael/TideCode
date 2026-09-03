const REGEX_PREFIX_KEYWORDS = new Set([
  'await',
  'case',
  'delete',
  'do',
  'else',
  'in',
  'instanceof',
  'of',
  'return',
  'throw',
  'typeof',
  'void',
  'yield',
])

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

function validateCodeModeSyntax(code: string) {
  return new AsyncFunction(code)
}

const PATCH_ARRAY_DECLARATION = /^\s*(?:const|let|var)\s+patch\s*=\s*\[\s*$/u
const PATCH_ARRAY_END = /^\s*\]\s*;?\s*$/u
const PATCH_RETURN = /^\s*return\s+(?:await\s+)?tools\.patch\(\s*\{\s*patch(?:\s*:\s*patch)?\s*\}\s*\)\s*;?\s*$/u
const RAW_PATCH_CONTROL_LINE = /^(?:\*\*\* (?:Begin Patch|End Patch)|\*\*\* (?:Add|Update|Delete) File:?.*|\*\*\* Move to:?.*|@@.*)$/u
const APPLY_PATCH_DIRECT_TEMPLATE = /\btools\.apply_patch\s*\(\s*$/u
const APPLY_PATCH_TEMPLATE_BINDING = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/u
const SOURCE_PAYLOAD_STRING_BINDING = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(String\.raw\s*)?(['"\x60])/gu
const MISSING_OBJECT_PROPERTY_COLON = /([,{]\s*)([A-Za-z_$][\w$]*)(\s+)(?=(?:['"\x60]|\[|\{|[-+]?\d|true\b|false\b|null\b|undefined\b|\/))/gu

function isEscaped(value: string, index: number) {
  let slashCount = 0
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
    slashCount += 1
  }
  return slashCount % 2 === 1
}

function decodePatchStringBody(value: string) {
  let decoded = ''

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character !== '\\') {
      decoded += character
      continue
    }

    const escaped = value[index + 1]
    if (escaped === undefined) {
      decoded += '\\'
      continue
    }

    const simpleEscapes: Record<string, string> = {
      '0': '\0',
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
      v: '\v',
      '\\': '\\',
      "'": "'",
      '"': '"',
    }
    const simpleValue = simpleEscapes[escaped]
    if (simpleValue !== undefined) {
      decoded += simpleValue
      index += 1
      continue
    }

    if (escaped === 'x' && /^[0-9A-Fa-f]{2}$/u.test(value.slice(index + 2, index + 4))) {
      decoded += String.fromCharCode(Number.parseInt(value.slice(index + 2, index + 4), 16))
      index += 3
      continue
    }

    if (escaped === 'u') {
      const codePoint = value.slice(index + 2, index + 6)
      if (/^[0-9A-Fa-f]{4}$/u.test(codePoint)) {
        decoded += String.fromCharCode(Number.parseInt(codePoint, 16))
        index += 5
        continue
      }
    }

    // JavaScript treats an unknown escape such as \$ as the escaped character.
    // This also turns the common model spelling \${...} back into the intended
    // patch text without evaluating any generated code.
    decoded += escaped
    index += 1
  }

  return decoded
}

function decodeLiteralPatchStringBody(value: string, quote: string) {
  if (quote !== "'" && quote !== '"') return decodePatchStringBody(value)
  const backslash = String.fromCharCode(92)
  let decoded = ''

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character === backslash && value[index + 1] === quote) {
      decoded += quote
      index += 1
      continue
    }
    decoded += character
  }

  return decoded
}

function decodePatchArrayLine(line: string) {
  const trimmed = line.trim()
  if (trimmed.length === 0) return null

  const withoutTrailingComma = trimmed.endsWith(',')
    ? trimmed.slice(0, -1).trimEnd()
    : trimmed
  const firstCharacter = withoutTrailingComma[0]

  if (firstCharacter !== "'" && firstCharacter !== '"') {
    return RAW_PATCH_CONTROL_LINE.test(withoutTrailingComma) ? withoutTrailingComma : null
  }

  let body = withoutTrailingComma.slice(1)
  const lastIndex = body.length - 1
  if (body[lastIndex] === firstCharacter && !isEscaped(body, lastIndex)) {
    body = body.slice(0, lastIndex)
  }

  return decodeLiteralPatchStringBody(body, firstCharacter)
}

function isPatchWhitespace(character: string | undefined) {
  if (character === undefined) return false
  const code = character.charCodeAt(0)
  return code === 9 || code === 10 || code === 13 || code === 32
}

function isPatchMarkerLineStart(value: string, index: number) {
  if (index === 0) return true
  const previous = value.charCodeAt(index - 1)
  return previous === 10 || previous === 13
}

function findPatchEndMarker(value: string, start: number) {
  const marker = '*** End Patch'
  const backtick = String.fromCharCode(96)
  let searchFrom = start

  while (searchFrom < value.length) {
    const index = value.indexOf(marker, searchFrom)
    if (index === -1) return -1
    const next = value[index + marker.length]
    if (
      isPatchMarkerLineStart(value, index) &&
      (next === undefined || next === backtick || isPatchWhitespace(next))
    ) {
      return index
    }
    searchFrom = index + 1
  }

  return -1
}

function patchTemplateReplacementStart(value: string, openingBacktick: number) {
  let cursor = openingBacktick - 1
  while (cursor >= 0 && (value[cursor] === ' ' || value.charCodeAt(cursor) === 9)) cursor -= 1

  const rawTag = 'String.raw'
  const start = cursor - rawTag.length + 1
  if (start < 0 || value.slice(start, cursor + 1) !== rawTag) return openingBacktick

  const previous = value[start - 1]
  if (previous !== undefined && /[A-Za-z0-9_$]/u.test(previous)) return openingBacktick
  return start
}

function decodePatchTemplateEscapes(body: string) {
  const backslash = String.fromCharCode(92)
  const backtick = String.fromCharCode(96)
  let output = ''

  for (let index = 0; index < body.length; index += 1) {
    const character = body[index]
    if (character !== backslash || index + 1 >= body.length) {
      output += character
      continue
    }

    const next = body[index + 1]
    if (next === backtick) {
      output += backtick
      index += 1
      continue
    }
    if (next === '$' && body[index + 2] === '{') {
      output += '$' + '{'
      index += 2
      continue
    }

    output += backslash
  }

  return output
}

function hasApplyPatchVariableUsage(value: string, variableName: string) {
  const marker = 'tools.apply_patch'
  let searchFrom = 0

  while (searchFrom < value.length) {
    const index = value.indexOf(marker, searchFrom)
    if (index === -1) return false
    let cursor = index + marker.length
    while (isPatchWhitespace(value[cursor])) cursor += 1
    if (value[cursor] !== '(') {
      searchFrom = index + 1
      continue
    }
    cursor += 1
    while (isPatchWhitespace(value[cursor])) cursor += 1
    if (value.slice(cursor, cursor + variableName.length) !== variableName) {
      searchFrom = index + 1
      continue
    }
    const afterName = value[cursor + variableName.length]
    if (afterName !== undefined && /[A-Za-z0-9_$]/u.test(afterName)) {
      searchFrom = index + 1
      continue
    }
    cursor += variableName.length
    while (isPatchWhitespace(value[cursor])) cursor += 1
    if (value[cursor] === ')') return true
    searchFrom = index + 1
  }

  return false
}

function isApplyPatchTemplate(value: string, replacementStart: number, closingBacktick: number) {
  const prefix = value.slice(0, replacementStart)
  if (APPLY_PATCH_DIRECT_TEMPLATE.test(prefix)) return true

  const variableName = prefix.match(APPLY_PATCH_TEMPLATE_BINDING)?.[1]
  if (!variableName) return false
  return hasApplyPatchVariableUsage(value.slice(closingBacktick + 1), variableName)
}

export function normalizeCodeModePatchTemplateLiterals(code: string) {
  const beginMarker = '*** Begin Patch'
  const endMarker = '*** End Patch'
  const backtick = String.fromCharCode(96)
  let result = code
  let searchFrom = 0

  while (searchFrom < result.length) {
    const begin = result.indexOf(beginMarker, searchFrom)
    if (begin === -1) break

    let opening = begin - 1
    while (opening >= 0 && isPatchWhitespace(result[opening])) opening -= 1
    if (opening < 0 || result[opening] !== backtick) {
      searchFrom = begin + beginMarker.length
      continue
    }

    const end = findPatchEndMarker(result, begin + beginMarker.length)
    if (end === -1) {
      searchFrom = begin + beginMarker.length
      continue
    }

    let closing = end + endMarker.length
    while (closing < result.length && isPatchWhitespace(result[closing])) closing += 1
    if (result[closing] !== backtick) {
      searchFrom = end + endMarker.length
      continue
    }

    const replacementStart = patchTemplateReplacementStart(result, opening)
    if (!isApplyPatchTemplate(result, replacementStart, closing)) {
      searchFrom = closing + 1
      continue
    }

    let body = result.slice(opening + 1, closing)
    if (replacementStart === opening) body = decodePatchTemplateEscapes(body)
    const quoted = JSON.stringify(body) ?? '""'
    result = result.slice(0, replacementStart) + quoted + result.slice(closing + 1)
    searchFrom = replacementStart + quoted.length
  }

  return result
}

/**
 * Repairs the narrow, model-generated patch-program shape that commonly fails
 * before JavaScript can run. The model contract is one patch line per array
 * item, so rebuilding that array as JSON string literals safely fixes missing
 * commas and an omitted closing quote without executing or broadly rewriting
 * arbitrary JavaScript.
 */
export function repairCodeModePatchProgram(code: string) {
  const lines = code.split(/\r?\n/u)
  const declarationIndex = lines.findIndex((line) => PATCH_ARRAY_DECLARATION.test(line))
  if (declarationIndex === -1) return null

  const endIndex = lines.findIndex(
    (line, index) => index > declarationIndex && PATCH_ARRAY_END.test(line),
  )
  if (endIndex === -1) return null

  const suffix = lines.slice(endIndex + 1).join('\n')
  if (!PATCH_RETURN.test(suffix)) return null

  const patchLines = lines.slice(declarationIndex + 1, endIndex)
  if (patchLines.length === 0) return null

  const decodedLines = patchLines.map(decodePatchArrayLine)
  if (decodedLines.some((line): line is null => line === null)) return null

  const repairedDeclaration = [
    'const patch = [',
    ...decodedLines.map((line, index) => {
      const comma = index < decodedLines.length - 1 ? ',' : ''
      return `  ${JSON.stringify(line)}${comma}`
    }),
    '];',
  ].join('\n')

  const prefix = lines.slice(0, declarationIndex).join('\n')
  return [prefix, repairedDeclaration, suffix]
    .filter((part) => part.length > 0)
    .join('\n')
}

function decodeRedundantTripleQuoteDelimiterEscapes(body: string, delimiter: "'" | '"') {
  let escapedCount = 0
  let hasUnescaped = false
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] !== delimiter) continue
    if (isEscaped(body, index)) escapedCount += 1
    else hasUnescaped = true
  }
  if (escapedCount === 0 || hasUnescaped) return body

  let decoded = ''
  for (let index = 0; index < body.length;) {
    if (body[index] !== '\\') {
      decoded += body[index]
      index += 1
      continue
    }

    const runStart = index
    while (index < body.length && body[index] === '\\') index += 1
    const runLength = index - runStart
    if (index < body.length && body[index] === delimiter && runLength % 2 === 1) {
      decoded += '\\'.repeat(runLength - 1) + delimiter
      index += 1
      continue
    }
    decoded += body.slice(runStart, index)
  }
  return decoded
}

function repairPythonTripleQuotedStrings(code: string) {
  let cursor = 0
  let output = ''
  let changed = false

  while (cursor < code.length) {
    let index = cursor
    let quote: "'" | '"' | '`' | null = null
    let inLineComment = false
    let inBlockComment = false
    let openingIndex = -1
    let delimiter: '"""' | "'''" | null = null

    while (index < code.length) {
      const character = code[index]
      const nextCharacter = code[index + 1]

      if (inLineComment) {
        if (character === '\n' || character === '\r') inLineComment = false
        index += 1
        continue
      }
      if (inBlockComment) {
        if (character === '*' && nextCharacter === '/') {
          inBlockComment = false
          index += 2
        } else {
          index += 1
        }
        continue
      }
      if (quote !== null) {
        if (character === '\\') {
          index += 2
          continue
        }
        if (character === quote) quote = null
        index += 1
        continue
      }

      if (character === '/' && nextCharacter === '/') {
        inLineComment = true
        index += 2
        continue
      }
      if (character === '/' && nextCharacter === '*') {
        inBlockComment = true
        index += 2
        continue
      }
      if (character === '"' && code.startsWith('"""', index)) {
        openingIndex = index
        delimiter = '"""'
        break
      }
      if (character === "'" && code.startsWith("'''", index)) {
        openingIndex = index
        delimiter = "'''"
        break
      }
      if (character === "'" || character === '"' || character === '`') {
        quote = character
      }
      index += 1
    }

    if (openingIndex === -1 || delimiter === null) {
      output += code.slice(cursor)
      break
    }

    let closingIndex = code.indexOf(delimiter, openingIndex + delimiter.length)
    while (closingIndex !== -1 && isEscaped(code, closingIndex)) {
      closingIndex = code.indexOf(delimiter, closingIndex + delimiter.length)
    }
    if (closingIndex === -1) {
      output += code.slice(cursor)
      break
    }

    const body = decodeRedundantTripleQuoteDelimiterEscapes(
      code.slice(openingIndex + delimiter.length, closingIndex),
      delimiter[0] as "'" | '"',
    )
    output += code.slice(cursor, openingIndex)
    output += JSON.stringify(body)
    cursor = closingIndex + delimiter.length
    changed = true
  }

  return changed ? output : code
}

function repairOverEscapedRegexLiteral(code: string): string | null {
  let candidate = code
  let repaired = false

  for (let attempt = 0; attempt < 16; attempt += 1) {
    let message = ''
    try {
      validateCodeModeSyntax(candidate)
      return repaired ? candidate : null
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    const prefix = 'Invalid regular expression: '
    const suffix = ': Unterminated group'
    const literalStart = message.indexOf(prefix)
    const literalEnd = message.lastIndexOf(suffix)
    if (literalStart === -1 || literalEnd === -1) return null

    const displayedLiteral = message.slice(literalStart + prefix.length, literalEnd)
    const sourceLiterals = [displayedLiteral]
    const decodedLiteral = displayedLiteral.replaceAll('\\\\', '\\')
    if (decodedLiteral !== displayedLiteral) sourceLiterals.push(decodedLiteral)

    let replacementApplied = false
    for (const invalidLiteral of sourceLiterals) {
      const repairedLiteral = invalidLiteral.replaceAll('\\\\(', '\\(')
      if (repairedLiteral === invalidLiteral) continue

      const literalIndex = candidate.indexOf(invalidLiteral)
      if (literalIndex === -1) continue

      candidate = candidate.slice(0, literalIndex)
        + repairedLiteral
        + candidate.slice(literalIndex + invalidLiteral.length)
      repaired = true
      replacementApplied = true
      break
    }

    if (!replacementApplied) return null
  }

  return null
}

export function repairCodeModeProgramSyntax(code: string): string | null {
  // Try -1: Repair narrow, high-confidence object/payload mistakes commonly
  // produced while models are emitting long freeform Code Mode programs.
  const fixedCommonProgram = repairSourcePayloadStringBindings(repairMissingObjectPropertyColons(code))
  if (fixedCommonProgram !== code) {
    try {
      validateCodeModeSyntax(fixedCommonProgram)
      return fixedCommonProgram
    } catch {
      // continue
    }
  }

  // Try -0.5: Repair a regex literal where a model doubled the escape before
  // a literal opening parenthesis, turning it into an unterminated group.
  const fixedRegexLiteral = repairOverEscapedRegexLiteral(code)
  if (fixedRegexLiteral !== null) return fixedRegexLiteral

  // Try 0: Repair Python-style triple-quoted strings without interpreting opposite delimiters or template expressions.
  if (code.includes('"""') || code.includes("'''")) {
    const fixedTripleQuotes = repairPythonTripleQuotedStrings(code)
    if (fixedTripleQuotes !== code) {
      try {
        validateCodeModeSyntax(fixedTripleQuotes)
        return fixedTripleQuotes
      } catch {
        // continue
      }
    }
  }

  // Try 0.5: Repair malformed string literals in tools.write / tools.edit source text.
  if (code.includes('content:') || code.includes('targetContent:') || code.includes('replacementContent:')) {
    const fixedMutationStrings = repairSourceMutationStringLiterals(code)
    if (fixedMutationStrings !== code) {
      try {
        validateCodeModeSyntax(fixedMutationStrings)
        return fixedMutationStrings
      } catch {
        // continue
      }
    }
  }

  // Try 0.75: Repair malformed string literals used as execute_terminal commands.
  if (code.includes('tools.execute_terminal') && code.includes('command')) {
    const fixedTerminalCommands = repairTerminalCommandStringLiterals(code)
    if (fixedTerminalCommands !== code) {
      try {
        validateCodeModeSyntax(fixedTerminalCommands)
        return fixedTerminalCommands
      } catch {
        // continue
      }
    }
  }

  // Try 1: Fix extra braces before closing brackets `}, }` -> `}` or `}, ]` -> `}]`
  let candidate = code.replace(/\},\s*\}/gu, '}')
  candidate = candidate.replace(/\},\s*\]/gu, '}]')
  candidate = candidate.replace(/,\s*([}\]])/gu, '$1')

  try {
    validateCodeModeSyntax(candidate)
    return candidate
  } catch {
    // continue
  }

  // Try 2: Remove a trailing stray closing brace at the very end of code
  const trimmed = code.trimEnd()
  if (trimmed.endsWith('}')) {
    const withoutLastBrace = trimmed.slice(0, trimmed.lastIndexOf('}')).trimEnd()
    try {
      validateCodeModeSyntax(withoutLastBrace)
      return withoutLastBrace
    } catch {
      // continue
    }
  }

  // Try 3: Balance unclosed brackets/braces/parentheses at end of program
  let openParens = 0
  let openBrackets = 0
  let openBraces = 0
  let inString: string | null = null

  for (let i = 0; i < code.length; i += 1) {
    const char = code[i]
    if (inString) {
      if (char === '\\') {
        i += 1
      } else if (char === inString) {
        inString = null
      }
      continue
    }

    if (char === "'" || char === '"' || char === '`') {
      inString = char
      continue
    }

    if (char === '(') openParens += 1
    else if (char === ')') openParens = Math.max(0, openParens - 1)
    else if (char === '[') openBrackets += 1
    else if (char === ']') openBrackets = Math.max(0, openBrackets - 1)
    else if (char === '{') openBraces += 1
    else if (char === '}') openBraces = Math.max(0, openBraces - 1)
  }

  let balanced = code
  if (openBrackets > 0) balanced += ']'.repeat(openBrackets)
  if (openBraces > 0) balanced += '}'.repeat(openBraces)
  if (openParens > 0) balanced += ')'.repeat(openParens)

  try {
    validateCodeModeSyntax(balanced)
    return balanced
  } catch {
    // continue
  }

  return null
}

type SourceMutationStringKey = 'content' | 'targetContent' | 'replacementContent'
type SourceMutationStringQuote = "'" | '"' | '`'

const SOURCE_MUTATION_STRING_FIELD = /\b(content|targetContent|replacementContent)\s*:\s*(['"`])/gu
const SOURCE_MUTATION_NEXT_PROPERTY = /^\s*,\s*(?:content|path|targetContent|replacementContent|startLine|endLine|replaceAll)\s*:/u

function hasSourceMutationStringTerminator(source: string, key: SourceMutationStringKey, quoteIndex: number) {
  const suffix = source.slice(quoteIndex + 1)
  if (SOURCE_MUTATION_NEXT_PROPERTY.test(suffix)) return true
  if (key === 'content') return /^\s*,?\s*\}/u.test(suffix)
  return /^\s*,?\s*\}\s*(?:,\s*\{|\]\s*\}\s*\))/u.test(suffix)
}

function escapeSourceMutationStringBody(value: string, quote: SourceMutationStringQuote) {
  let escaped = ''

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    const nextCharacter = value[index + 1]

    if (quote !== '`') {
      if (character === '\r') {
        if (nextCharacter === '\n') index += 1
        escaped += nextCharacter === '\n' ? '\\r\\n' : '\\r'
        continue
      }
      if (character === '\n') {
        escaped += '\\n'
        continue
      }
      if (character === '\u2028') {
        escaped += '\\u2028'
        continue
      }
      if (character === '\u2029') {
        escaped += '\\u2029'
        continue
      }
    }

    if (character === quote && !isEscaped(value, index)) {
      escaped += `\\${character}`
      continue
    }

    if (quote === '`' && character === '$' && nextCharacter === '{' && !isEscaped(value, index)) {
      escaped += '\\${'
      index += 1
      continue
    }

    escaped += character
  }

  return escaped
}

function hasGeneratedBindingTerminator(source: string, quoteIndex: number) {
  const suffix = source.slice(quoteIndex + 1)
  return (
    /^\s*;?\s*(?:\r?\n|$)/u.test(suffix) ||
    /^\s*;\s*(?:const|let|var|return|await)\b/u.test(suffix)
  )
}

function hasToolArgumentBindingUsage(source: string, variableName: string) {
  const executable = maskNonExecutableText(source)
  const shorthand = new RegExp(
    `\\btools\\.[A-Za-z_$][\\w$]*\\s*\\(\\s*\\{[\\s\\S]*?\\b${variableName}\\b\\s*(?:[,}])`,
    'u',
  )
  const explicitValue = new RegExp(
    `\\btools\\.[A-Za-z_$][\\w$]*\\s*\\(\\s*\\{[\\s\\S]*?\\b[A-Za-z_$][\\w$]*\\s*:\\s*${variableName}\\b`,
    'u',
  )
  return shorthand.test(executable) || explicitValue.test(executable)
}

/**
 * Repairs long model-generated payload bindings before they are passed into a
 * tool object, for example a plan binding initialized with String.raw and later
 * passed as `tools.plan_create({ content: plan })`.
 * String.raw templates are replaced with JSON string literals so Markdown
 * backticks and ${...} text
 * keep their literal value instead of becoming JavaScript syntax.
 */
export function repairSourcePayloadStringBindings(code: string): string {
  let result = code
  let searchFrom = 0

  while (searchFrom < result.length) {
    SOURCE_PAYLOAD_STRING_BINDING.lastIndex = searchFrom
    const match = SOURCE_PAYLOAD_STRING_BINDING.exec(result)
    if (!match || match.index === undefined) break

    const rawTag = match[2] ?? ''
    const quote = match[3] as SourceMutationStringQuote
    const openingQuoteIndex = SOURCE_PAYLOAD_STRING_BINDING.lastIndex - 1
    const startBodyIndex = openingQuoteIndex + 1
    let endBodyIndex = -1

    for (let index = startBodyIndex; index < result.length; index += 1) {
      if (result[index] !== quote || isEscaped(result, index)) continue
      if (!hasGeneratedBindingTerminator(result, index)) continue
      endBodyIndex = index
      break
    }

    if (endBodyIndex === -1) {
      searchFrom = startBodyIndex
      continue
    }

    const rawBody = result.slice(startBodyIndex, endBodyIndex)
    const bindingName = match[1] ?? ''
    if (!hasToolArgumentBindingUsage(result.slice(endBodyIndex + 1), bindingName)) {
      searchFrom = endBodyIndex + 1
      continue
    }
    if (rawTag.length > 0 && quote === '\x60') {
      const expressionStart = openingQuoteIndex - rawTag.length
      const literal = JSON.stringify(rawBody)
      result = result.slice(0, expressionStart) + literal + result.slice(endBodyIndex + 1)
      searchFrom = expressionStart + literal.length
      continue
    }

    const safeBody = escapeSourceMutationStringBody(rawBody, quote)
    if (safeBody === rawBody) {
      searchFrom = endBodyIndex + 1
      continue
    }

    result = result.slice(0, startBodyIndex) + safeBody + result.slice(endBodyIndex)
    searchFrom = startBodyIndex + safeBody.length + 1
  }

  return result
}

/**
 * Repairs a narrow invalid-object shape models occasionally emit in tool
 * arguments, such as `{ include \"*.go\" }`. Only executable object-property
 * keys are touched, so matching text inside strings, comments, regexes, and
 * template text is left unchanged.
 */
export function repairMissingObjectPropertyColons(code: string): string {
  const masked = maskNonExecutableText(code)
  const insertions: number[] = []
  MISSING_OBJECT_PROPERTY_COLON.lastIndex = 0

  for (let match = MISSING_OBJECT_PROPERTY_COLON.exec(code); match; match = MISSING_OBJECT_PROPERTY_COLON.exec(code)) {
    if (match.index === undefined) continue
    const prefixLength = match[1]?.length ?? 0
    const key = match[2] ?? ''
    const keyStart = match.index + prefixLength
    if (masked.slice(keyStart, keyStart + key.length) !== key) continue
    insertions.push(keyStart + key.length)
  }

  if (insertions.length === 0) return code
  let result = code
  for (let index = insertions.length - 1; index >= 0; index -= 1) {
    const position = insertions[index]
    if (position !== undefined) result = result.slice(0, position) + ':' + result.slice(position)
  }
  return result
}

/**
 * Repairs malformed model-generated source payload strings for tools.write and
 * tools.edit. Only content/targetContent/replacementContent values are touched,
 * and only when a same-delimiter quote, raw line break, backtick, or template
 * expression would otherwise terminate or interpolate the generated program.
 */
export function repairSourceMutationStringLiterals(code: string): string {
  let result = code
  let searchFrom = 0

  while (searchFrom < result.length) {
    SOURCE_MUTATION_STRING_FIELD.lastIndex = searchFrom
    const match = SOURCE_MUTATION_STRING_FIELD.exec(result)
    if (!match || match.index === undefined) break

    const key = match[1] as SourceMutationStringKey
    const quote = match[2] as SourceMutationStringQuote
    const startBodyIndex = SOURCE_MUTATION_STRING_FIELD.lastIndex
    let endBodyIndex = -1

    for (let index = startBodyIndex; index < result.length; index += 1) {
      if (result[index] !== quote || isEscaped(result, index)) continue
      if (!hasSourceMutationStringTerminator(result, key, index)) continue
      endBodyIndex = index
      break
    }

    if (endBodyIndex === -1) {
      searchFrom = startBodyIndex
      continue
    }

    const rawBody = result.slice(startBodyIndex, endBodyIndex)
    const safeBody = escapeSourceMutationStringBody(rawBody, quote)
    if (safeBody === rawBody) {
      searchFrom = endBodyIndex + 1
      continue
    }

    result = result.slice(0, startBodyIndex) + safeBody + result.slice(endBodyIndex)
    searchFrom = startBodyIndex + safeBody.length + 1
  }

  return result
}

type TerminalCommandStringQuote = "'" | '"' | '`'

const TERMINAL_COMMAND_STRING_FIELD = /\bcommand\s*:\s*(['"`])/gu
const TERMINAL_COMMAND_STRING_REFERENCE = /\bcommand\s*:\s*([A-Za-z_$][\w$]*)/gu
const TERMINAL_COMMAND_STRING_BINDING = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])/gu

function hasTerminalCommandFieldTerminator(source: string, quoteIndex: number) {
  const suffix = source.slice(quoteIndex + 1)
  return /^\s*(?:,\s*[A-Za-z_$][\w$]*\s*:|,?\s*\})/u.test(suffix)
}

function hasTerminalCommandBindingTerminator(source: string, quoteIndex: number) {
  const suffix = source.slice(quoteIndex + 1)
  return (
    /^\s*;?\s*(?:\r?\n|$)/u.test(suffix) ||
    /^\s*;\s*(?:const|let|var|return|await)\b/u.test(suffix)
  )
}

function repairGeneratedStringLiteral(
  source: string,
  openingQuoteIndex: number,
  quote: TerminalCommandStringQuote,
  hasTerminator: (source: string, quoteIndex: number) => boolean,
) {
  const startBodyIndex = openingQuoteIndex + 1
  let endBodyIndex = -1

  for (let index = startBodyIndex; index < source.length; index += 1) {
    if (source[index] !== quote || isEscaped(source, index)) continue
    if (!hasTerminator(source, index)) continue
    endBodyIndex = index
    break
  }

  if (endBodyIndex === -1) return source

  const rawBody = source.slice(startBodyIndex, endBodyIndex)
  const safeBody = escapeSourceMutationStringBody(rawBody, quote)
  if (safeBody === rawBody) return source

  return source.slice(0, startBodyIndex) + safeBody + source.slice(endBodyIndex)
}

/**
 * Repairs generated execute_terminal commands without broadly rewriting JS.
 * It handles quoted command properties and quoted variables referenced by a
 * command property, escaping only the string body while preserving its value.
 */
export function repairTerminalCommandStringLiterals(code: string): string {
  let result = code
  let searchFrom = 0

  while (searchFrom < result.length) {
    TERMINAL_COMMAND_STRING_FIELD.lastIndex = searchFrom
    const match = TERMINAL_COMMAND_STRING_FIELD.exec(result)
    if (!match || match.index === undefined) break

    const quote = match[1] as TerminalCommandStringQuote
    const openingQuoteIndex = TERMINAL_COMMAND_STRING_FIELD.lastIndex - 1
    const repaired = repairGeneratedStringLiteral(result, openingQuoteIndex, quote, hasTerminalCommandFieldTerminator)
    if (repaired === result) {
      searchFrom = openingQuoteIndex + 1
      continue
    }

    result = repaired
    searchFrom = openingQuoteIndex + 1
  }

  const referencedBindings = new Set<string>()
  TERMINAL_COMMAND_STRING_REFERENCE.lastIndex = 0
  for (let match = TERMINAL_COMMAND_STRING_REFERENCE.exec(result); match; match = TERMINAL_COMMAND_STRING_REFERENCE.exec(result)) {
    if (match[1]) referencedBindings.add(match[1])
  }

  searchFrom = 0
  while (searchFrom < result.length) {
    TERMINAL_COMMAND_STRING_BINDING.lastIndex = searchFrom
    const match = TERMINAL_COMMAND_STRING_BINDING.exec(result)
    if (!match || match.index === undefined) break

    const bindingName = match[1] ?? ''
    const quote = match[2] as TerminalCommandStringQuote
    const openingQuoteIndex = TERMINAL_COMMAND_STRING_BINDING.lastIndex - 1
    if (!referencedBindings.has(bindingName)) {
      searchFrom = openingQuoteIndex + 1
      continue
    }

    const repaired = repairGeneratedStringLiteral(result, openingQuoteIndex, quote, hasTerminalCommandBindingTerminator)
    if (repaired === result) {
      searchFrom = openingQuoteIndex + 1
      continue
    }

    result = repaired
    searchFrom = openingQuoteIndex + 1
  }

  return result
}

export function repairNestedTemplateLiterals(code: string): string {
  return repairSourceMutationStringLiterals(code)
}

function isRegexStart(source: string, index: number) {
  let previousIndex = index - 1
  while (previousIndex >= 0 && /\s/u.test(source[previousIndex] ?? '')) previousIndex -= 1
  if (previousIndex < 0) return true

  const previousCharacter = source[previousIndex]
  if ('([{=:;,!?&+-*%^~<>'.includes(previousCharacter ?? '')) return true

  let tokenStart = previousIndex
  while (tokenStart >= 0 && /[A-Za-z0-9_$]/u.test(source[tokenStart] ?? '')) tokenStart -= 1
  const previousToken = source.slice(tokenStart + 1, previousIndex + 1)
  return REGEX_PREFIX_KEYWORDS.has(previousToken)
}

export function maskNonExecutableText(source: string) {
  const masked = source.split('')
  const blank = (start: number, end: number) => {
    for (let index = start; index < end; index += 1) masked[index] = ' '
  }

  const skipQuotedString = (start: number, quote: "'" | '"') => {
    let index = start + 1
    while (index < source.length) {
      if (source[index] === '\\') {
        index += 2
        continue
      }
      if (source[index] === quote) return index + 1
      index += 1
    }
    return source.length
  }

  const skipLineComment = (start: number) => {
    const lineEnd = source.indexOf('\n', start + 2)
    return lineEnd === -1 ? source.length : lineEnd
  }

  const skipBlockComment = (start: number) => {
    const commentEnd = source.indexOf('*/', start + 2)
    return commentEnd === -1 ? source.length : commentEnd + 2
  }

  const skipRegexLiteral = (start: number) => {
    let index = start + 1
    let inCharacterClass = false
    while (index < source.length) {
      if (source[index] === '\\') {
        index += 2
        continue
      }
      if (source[index] === '[') inCharacterClass = true
      if (source[index] === ']') inCharacterClass = false
      if (source[index] === '/' && !inCharacterClass) {
        index += 1
        while (/[A-Za-z]/u.test(source[index] ?? '')) index += 1
        return index
      }
      index += 1
    }
    return source.length
  }

  const scanCode = (start: number, stopAtClosingBrace: boolean): number => {
    let index = start
    let braceDepth = 0

    while (index < source.length) {
      const character = source[index]
      const nextCharacter = source[index + 1]

      if (stopAtClosingBrace && character === '}' && braceDepth === 0) return index + 1
      if (character === '/' && nextCharacter === '/') {
        const end = skipLineComment(index)
        blank(index, end)
        index = end
        continue
      }
      if (character === '/' && nextCharacter === '*') {
        const end = skipBlockComment(index)
        blank(index, end)
        index = end
        continue
      }
      if (character === "'" || character === '"') {
        const end = skipQuotedString(index, character)
        blank(index, end)
        index = end
        continue
      }
      if (character === '`') {
        index += 1
        let textStart = index - 1
        while (index < source.length) {
          if (source[index] === '\\') {
            index += 2
            continue
          }
          if (source[index] === '`') {
            blank(textStart, index + 1)
            index += 1
            break
          }
          if (source[index] === '$' && source[index + 1] === '{') {
            blank(textStart, index + 2)
            index = scanCode(index + 2, true)
            textStart = index
            continue
          }
          index += 1
        }
        if (index >= source.length) blank(textStart, source.length)
        continue
      }
      if (character === '/' && nextCharacter !== '/' && nextCharacter !== '*' && isRegexStart(source, index)) {
        const end = skipRegexLiteral(index)
        blank(index, end)
        index = end
        continue
      }
      if (character === '{') braceDepth += 1
      if (character === '}' && braceDepth > 0) braceDepth -= 1
      index += 1
    }

    return index
  }

  scanCode(0, false)
  return masked.join('')
}

const PRELOADED_TOOLS_IMPORT = /^\s*(?:const|let|var)\s+\{\s*tools\s*\}\s*=\s*await\s+import\(\s*(['"])\.\/tools\.js\1\s*\)\s*;?[ \t]*(?:\r?\n|$)/u

export function repairCodeModePreloadedToolsImport(code: string): string | null {
  const match = PRELOADED_TOOLS_IMPORT.exec(code)
  if (match === null) return null

  const repaired = code.slice(match[0].length)
  if (!/\btools\s*\./u.test(maskNonExecutableText(repaired))) return null
  return repaired
}

export function containsDynamicCodeModeImport(code: string): boolean {
  return /\bimport\s*\(/u.test(maskNonExecutableText(code))
}

const BLOCKED_CODE_MODE_RUNTIME_APIS = [
  { name: 'process', pattern: /\bprocess\b/u },
  { name: 'global', pattern: /\bglobal\b/u },
  { name: 'require', pattern: /\brequire\s*\(/u },
  { name: 'module', pattern: /\bmodule\b/u },
  { name: 'fs', pattern: /\bfs\s*\./u },
  { name: 'child_process', pattern: /\bchild_process\b/u },
  { name: 'http', pattern: /\bhttp\b/u },
  { name: 'https', pattern: /\bhttps\b/u },
  { name: 'net', pattern: /\bnet\b/u },
  { name: 'fetch', pattern: /\bfetch\s*\(/u },
  { name: 'Worker', pattern: /\bWorker\b/u },
  { name: 'worker_threads', pattern: /\bworker_threads\b/u },
  { name: 'Buffer', pattern: /\bBuffer\b/u },
  { name: 'WebAssembly', pattern: /\bWebAssembly\b/u },
  { name: 'Electron', pattern: /\bElectron\b/u },
  { name: 'Bun', pattern: /\bBun\b/u },
  { name: 'Deno', pattern: /\bDeno\b/u },
  { name: 'eval', pattern: /\beval\s*\(/u },
  { name: 'Function', pattern: /\bFunction\s*\(/u },
  { name: 'Function constructor', pattern: /\.constructor\s*\(/u },
] as const

export function findBlockedCodeModeRuntimeApi(code: string): string | null {
  const executableCode = maskNonExecutableText(code)
  for (const blockedApi of BLOCKED_CODE_MODE_RUNTIME_APIS) {
    if (blockedApi.pattern.test(executableCode)) return blockedApi.name
  }
  return null
}

export function validateCodeModeProgram(code: string, maxCodeBytes: number) {
  if (code.trim().length === 0) return 'Code Mode requires a non-empty JavaScript program.'
  if (new TextEncoder().encode(code).byteLength > maxCodeBytes) {
    return `Code Mode program exceeds the ${maxCodeBytes}-byte limit.`
  }

  try {
    validateCodeModeSyntax(code)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? error.stack ?? '' : ''
    const location = /tidecode-code-mode\.js:(\d+)(?::(\d+))?/u.exec(stack)
    const line = location ? Math.max(1, Number(location[1]) - 1) : null
    const column = location?.[2] ? Number(location[2]) : null
    const position = line === null
      ? ''
      : ` at generated code line ${line}${column === null ? '' : `, column ${column}`}`
    let guidance = 'No tool ran. Retry with valid plain sequential tools.* calls using only APIs permitted by the active mode.'
    if (message.includes("Unexpected identifier") || message.includes("Invalid or unexpected token") || message.includes("Unexpected token")) {
      guidance += " If embedding code snippets or template literals inside script strings, make sure backticks (`) and template expressions (${...}) are properly escaped."
    }
    return `Code Mode program has invalid JavaScript${position}: ${message} ${guidance}`
  }

  return null
}
