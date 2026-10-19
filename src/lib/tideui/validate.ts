import { parseTideUI } from './parser'
import type { TideDocument, TideNode } from './types'
import { isSafeTideUrl } from './assetPolicy'
import { TIDE_ACTIONS, isTideTimerAction } from './capabilities'
import { validTideTimerMinutes } from './timer'
import { getTidePointValue } from './pointValue'

const CHILD_RULES: Record<string, ReadonlySet<string>> = {
  chart: new Set(['point']),
  sparkline: new Set(['point']),
  select: new Set(['option']),
  tabs: new Set(['tab']),
  timeline: new Set(['event', 'row']),
  flow: new Set(['node', 'edge']),
  table: new Set(['row', 'text']),
}
const NUMERIC_PROPERTIES = ['min', 'max', 'step'] as const
const CHART_TYPES = new Set(['line', 'bars', 'bar', 'pie'])

/** Validates the entire document before any part is rendered. */
export function validateTideUI(source: string): TideDocument {
  const document = parseTideUI(source)
  const errors = [...document.errors]
  const warnings = [...document.warnings]
  const ids = new Set<string>()
  const visit = (node: TideNode, parent?: TideNode) => {
    if (parent && CHILD_RULES[parent.kind] && !CHILD_RULES[parent.kind].has(node.kind)) {
      errors.push(`Line ${node.line}: ${node.kind} cannot be inside ${parent.kind}`)
    }
    if (node.props.id) {
      if (!/^[A-Za-z][\w-]{0,63}$/u.test(node.props.id) || ids.has(node.props.id)) {
        errors.push(`Line ${node.line}: invalid or duplicate id`)
      }
      ids.add(node.props.id)
    }
    for (const key of NUMERIC_PROPERTIES) {
      if (node.props[key] !== undefined && !Number.isFinite(Number(node.props[key]))) {
        errors.push(`Line ${node.line}: ${key} must be numeric`)
      }
    }
    if (node.props.action && !TIDE_ACTIONS.has(node.props.action)) {
      if (warnings.length < 20) warnings.push(`Line ${node.line}: unsupported action disabled`)
    }
    if (node.props.hover && !['none', 'highlight', 'lift', 'glow'].includes(node.props.hover)) {
      errors.push(`Line ${node.line}: invalid hover style`)
    }
    if (node.props.interactive && !['true', 'false'].includes(node.props.interactive)) {
      errors.push(`Line ${node.line}: interactive must be true or false`)
    }
    if (node.kind === 'timer' && !validTideTimerMinutes(Number(node.props.duration ?? node.args[1] ?? 25))) {
      errors.push(`Line ${node.line}: timer duration must be 1 to 240 whole minutes`)
    }
    if (node.kind === 'timer' && !node.props.id) {
      errors.push(`Line ${node.line}: timer requires a unique id`)
    }
    if (node.kind === 'button' && node.props.action && isTideTimerAction(node.props.action) && !node.props.target) {
      errors.push(`Line ${node.line}: timer action requires a target`)
    }
    if (node.props.tone && !['neutral', 'success', 'positive', 'good', 'warning', 'warn', 'caution', 'danger', 'error', 'negative', 'info', 'informational'].includes(node.props.tone)) {
      if (warnings.length < 20) warnings.push(`Line ${node.line}: unknown tone "${node.props.tone}" shown as neutral`)
    }
    if (node.kind === 'button' && node.props.action === 'send' && !node.props.message?.trim()) {
      errors.push(`Line ${node.line}: send action requires message="..."`)
    }
    if (node.kind === 'chart' && !CHART_TYPES.has(node.args[0] ?? 'line')) {
      errors.push(`Line ${node.line}: unsupported chart type`)
    }
    if (node.kind === 'point' && getTidePointValue(node) === null) {
      errors.push(`Line ${node.line}: point requires a numeric value`)
    }
    if (node.kind === 'button' && node.props.action === 'open' && !node.props.url) {
      errors.push(`Line ${node.line}: open action requires url`)
    }
    for (const key of ['src', 'url']) {
      if (node.props[key] && !isSafeTideUrl(node.props[key])) {
        errors.push(`Line ${node.line}: unsupported URL`)
      }
    }
    if (node.props.message && node.props.message.length > 4000) {
      errors.push(`Line ${node.line}: message is too long`)
    }
    for (const child of node.children) visit(child, node)
  }
  for (const node of document.nodes) visit(node)
  return { nodes: errors.length ? [] : document.nodes, errors: errors.slice(0, 20), warnings: warnings.slice(0, 20) }
}
