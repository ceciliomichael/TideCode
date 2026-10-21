import type { TideDocument, TideNode } from './types'

export const TIDEUI_MAX_SOURCE = 40_000
export const TIDEUI_MAX_NODES = 250
export const TIDEUI_MAX_DEPTH = 12

export const TIDEUI_KINDS = new Set([
  'panel', 'card', 'row', 'column', 'grid', 'section', 'divider',
  'heading', 'text', 'label', 'caption', 'code', 'badge', 'alert', 'progress', 'metric',
  'table', 'list', 'comparison', 'item', 'chart', 'point', 'sparkline',
  'timeline', 'event', 'flow', 'node', 'edge',
  'button', 'copy', 'input', 'textarea', 'select', 'option', 'checkbox', 'slider', 'toggle',
  'tabs', 'tab', 'expand', 'link', 'image', 'gallery', 'timer', 'modal', 'html',
])

const PERMITTED_PROPERTIES = new Set([
  'id', 'action', 'target', 'message', 'url', 'lang', 'copy', 'default', 'min', 'max',
  'step', 'value', 'columns', 'placeholder', 'src', 'alt', 'required', 'mode',
  'title', 'label', 'width', 'to', 'from', 'disabled', 'tone', 'checked',
  'hover', 'interactive', 'duration', 'hint',
  'background', 'color', 'border-color', 'radius', 'padding', 'gap', 'font-size',
  'hover-background', 'hover-color', 'hover-border-color', 'size', 'dismiss',
])

const ENTRY_KINDS = new Set(['item', 'point', 'row', 'event', 'text', 'label', 'caption', 'option', 'tab'])
const PARENT_ENTRY_KIND: Record<string, string> = {
  chart: 'point', sparkline: 'point', timeline: 'event', table: 'row',
  list: 'item', comparison: 'item', select: 'option', tabs: 'tab',
}

function resolvePresentationKind(kind: string, parent?: TideNode): string {
  if (ENTRY_KINDS.has(kind)) {
    const contextualKind = parent && PARENT_ENTRY_KIND[parent.kind]
    if (contextualKind) {
      return contextualKind
    }
    if (['point', 'event', 'option', 'tab'].includes(kind)) {
      return 'item'
    }
  }
  return kind
}

/** Read only literal tokens and quoted strings, with no expression interpolation. */
export function tokenizeTideUILine(line: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quoted = false
  let escaped = false
  let started = false
  for (const character of line) {
    if (escaped) {
      if (character !== '"' && character !== '\\') {
        current += '\\'
      }
      current += character
      escaped = false
      continue
    }
    if (quoted && character === '\\') {
      escaped = true
      continue
    }
    if (character === '"') {
      quoted = !quoted
      started = true
      continue
    }
    if (!quoted && /\s/u.test(character)) {
      if (started) {
        tokens.push(current)
        current = ''
        started = false
      }
      continue
    }
    current += character
    started = true
  }
  if (quoted) throw new Error('Unterminated quoted string')
  if (started) tokens.push(current)
  return tokens
}

export function parseTideUI(source: string): TideDocument {
  if (source.length > TIDEUI_MAX_SOURCE) {
    return { nodes: [], errors: ['TideUI source exceeds the 40 KB limit'], warnings: [] }
  }
  const nodes: TideNode[] = []
  const errors: string[] = []
  const warnings: string[] = []
  const ancestors: TideNode[] = []
  let count = 0
  for (const [index, line] of source.replace(/\r\n?/gu, '\n').split('\n').entries()) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const indent = line.length - line.trimStart().length
    const depth = indent / 2
    if (indent % 2 !== 0 || depth > TIDEUI_MAX_DEPTH || line.includes('\t')) {
      errors.push(`Line ${index + 1}: use two-space indentation (maximum depth 12)`)
      continue
    }
    if (line.trimStart().startsWith('|')) {
      const parent = ancestors[depth - 1]
      if (!parent || depth < 1) {
        errors.push(`Line ${index + 1}: raw text needs a parent component`)
        continue
      }
      parent.text += (parent.text ? '\n' : '') + line.trimStart().slice(1).replace(/^ /u, '')
      continue
    }
    let tokens: string[]
    try {
      tokens = tokenizeTideUILine(line.trim())
    } catch (error) {
      errors.push(`Line ${index + 1}: ${error instanceof Error ? error.message : 'invalid syntax'}`)
      continue
    }
    const declaredKind = tokens.shift() ?? ''
    const parent = depth > 0 ? ancestors[depth - 1] : undefined
    const isUnknownKind = !TIDEUI_KINDS.has(declaredKind)
    let kind = declaredKind
    if (isUnknownKind) {
      kind = 'text'
      if (warnings.length < 20) {
        warnings.push(`Line ${index + 1}: unknown presentation "${declaredKind}" rendered as text`)
      }
    }
    kind = resolvePresentationKind(kind, parent)
    const props: Record<string, string> = {}
    const args: string[] = []
    for (const token of tokens) {
      const match = /^([a-z][a-z0-9-]*)=(.*)$/u.exec(token)
      if (!match) {
        if (/^[A-Za-z][\w-]*=/u.test(token)) {
          errors.push(`Line ${index + 1}: invalid property "${token.split('=')[0]}"`)
          continue
        }
        args.push(token)
        continue
      }
      if (!PERMITTED_PROPERTIES.has(match[1])) {
        // Unknown optional presentation attributes are inert. Models may invent
        // visual properties; ignoring them must not discard an otherwise valid
        // dashboard or its controls.
        if (warnings.length < 20) {
          warnings.push(`Line ${index + 1}: ignored unknown property "${match[1]}"`)
        }
        continue
      }
      if (Object.hasOwn(props, match[1])) {
        errors.push(`Line ${index + 1}: duplicate property "${match[1]}"`)
        continue
      }
      props[match[1]] = match[2]
    }
    const displayArgs = isUnknownKind && kind === 'text' ? [args.join(' · ')] : args
    const node: TideNode = { kind, args: displayArgs, props, children: [], line: index + 1, text: '' }
    if (depth === 0) {
      nodes.push(node)
    } else {
      if (!parent) {
        errors.push(`Line ${index + 1}: missing parent for depth ${depth}`)
        continue
      }
      parent.children.push(node)
    }
    ancestors.length = depth
    ancestors.push(node)
    count++
    if (count > TIDEUI_MAX_NODES) {
      return { nodes: [], errors: ['TideUI exceeds the 250-component limit'], warnings }
    }
  }
  return { nodes, errors, warnings }
}
