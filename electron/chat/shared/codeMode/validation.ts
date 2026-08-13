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

export function repairCodeModeProgramSyntax(code: string): string | null {
  // Try 0: Fix invalid Python-style triple quotes `"""..."""` or `'''...'''` by replacing them with JS template literal backticks
  if (code.includes('"""') || code.includes("'''")) {
    const fixedTripleQuotes = code
      .replace(/"""([\s\S]*?)"""/gu, (_match, body) => '`' + body.replace(/`/gu, '\\`') + '`')
      .replace(/'''([\s\S]*?)'''/gu, (_match, body) => '`' + body.replace(/`/gu, '\\`') + '`')

    try {
      validateCodeModeSyntax(fixedTripleQuotes)
      return fixedTripleQuotes
    } catch {
      // continue
    }
  }

  // Try 0.5: Repair unescaped inner backticks or template expressions inside tools.write / tools.edit template literals
  if (code.includes('content:') || code.includes('targetContent:') || code.includes('replacementContent:')) {
    const fixedNestedBackticks = repairNestedTemplateLiterals(code)
    if (fixedNestedBackticks !== code) {
      try {
        validateCodeModeSyntax(fixedNestedBackticks)
        return fixedNestedBackticks
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

export function repairNestedTemplateLiterals(code: string): string {
  const keys = ['content', 'targetContent', 'replacementContent']
  let result = code

  for (const key of keys) {
    const keyMarker = `${key}: \``
    let pos = 0
    while ((pos = result.indexOf(keyMarker, pos)) !== -1) {
      const startBodyIndex = pos + keyMarker.length
      let endBodyIndex = -1
      for (let i = result.length - 1; i > startBodyIndex; i--) {
        if (result[i] === '`') {
          const rest = result.slice(i + 1).trimStart()
          if (rest.startsWith('}') || rest.startsWith(',') || rest.startsWith(')')) {
            endBodyIndex = i
            break
          }
        }
      }

      if (endBodyIndex > startBodyIndex) {
        const rawBody = result.slice(startBodyIndex, endBodyIndex)
        const safeBody = rawBody
          .replace(/(?<!\\)`/gu, '\\`')
          .replace(/(?<!\\)\$\{/gu, '\\${')

        result = result.slice(0, startBodyIndex) + safeBody + result.slice(endBodyIndex)
        pos = startBodyIndex + safeBody.length + 1
      } else {
        pos += keyMarker.length
      }
    }
  }

  return result
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

export function containsDynamicCodeModeImport(code: string): boolean {
  return /\bimport\s*\(/u.test(maskNonExecutableText(code))
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
    let guidance = "No tool ran. Retry with plain sequential tools.* calls. For source changes use tools.edit({ path, edits }); keep one path per call, use complete source text in targetContent/replacementContent, and do not include read metadata or the EOF footer."
    if (message.includes("Unexpected identifier") || message.includes("Invalid or unexpected token") || message.includes("Unexpected token")) {
      guidance += " If embedding code snippets or template literals inside script strings, make sure backticks (`) and template expressions (${...}) are properly escaped."
    }
    return `Code Mode program has invalid JavaScript${position}: ${message} ${guidance}`
  }

  return null
}
