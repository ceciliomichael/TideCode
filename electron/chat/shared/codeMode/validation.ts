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

  return decodePatchStringBody(body)
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

    output += code.slice(cursor, openingIndex)
    output += JSON.stringify(code.slice(openingIndex + delimiter.length, closingIndex))
    cursor = closingIndex + delimiter.length
    changed = true
  }

  return changed ? output : code
}

export function repairCodeModeProgramSyntax(code: string): string | null {
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
    let guidance = "No tool ran. Retry with plain sequential tools.* calls. For targeted source changes, call tools.apply_patch with one raw Codex patch string using complete patch lines and fresh source context. Use tools.write only for a deliberate whole-file write."
    if (message.includes("Unexpected identifier") || message.includes("Invalid or unexpected token") || message.includes("Unexpected token")) {
      guidance += " If embedding code snippets or template literals inside script strings, make sure backticks (`) and template expressions (${...}) are properly escaped."
    }
    return `Code Mode program has invalid JavaScript${position}: ${message} ${guidance}`
  }

  return null
}
