import type { CSSProperties } from 'react'
import type { TideNode } from './types'

const COLOR = /^(?:#[0-9a-fA-F]{3,4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|(?:rgb|rgba|hsl|hsla)\(\s*[\d.% ,/+-]+\s*\)|transparent|currentColor|(?:black|white|red|blue|green|yellow|orange|purple|pink|gray|grey|teal|navy|inherit))$/u
const SIZE = /^(?:0|\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw))$/u
const RADIUS = /^(?:none|sm|md|lg|xl|full|\d+(?:\.\d+)?(?:px|rem|em))$/u

export const TIDE_STYLE_PROPERTIES = new Set([
  'background', 'color', 'border-color', 'radius', 'padding', 'gap', 'font-size',
  'hover-background', 'hover-color', 'hover-border-color',
])

export function isValidTideStyleProperty(name: string, value: string): boolean {
  if (!TIDE_STYLE_PROPERTIES.has(name) || value.length > 100) return false
  if (name.includes('color') || name === 'background' || name === 'hover-background') {
    return COLOR.test(value)
  }
  if (name === 'radius') return RADIUS.test(value)
  return SIZE.test(value)
}

function radius(value: string): string {
  const named: Record<string, string> = {
    none: '0', sm: '4px', md: '8px', lg: '12px', xl: '16px', full: '9999px',
  }
  return named[value] ?? value
}

/** No raw CSS, URLs, variables or arbitrary expression evaluation from AI text. */
export function getTideNodeStyle(node: TideNode): CSSProperties {
  const styles: Record<string, string> = {}
  const properties: Record<string, string> = {
    background: 'backgroundColor',
    color: 'color',
    'border-color': 'borderColor',
    radius: 'borderRadius',
    padding: 'padding',
    gap: 'gap',
    'font-size': 'fontSize',
    'hover-background': '--tideui-hover-background',
    'hover-color': '--tideui-hover-color',
    'hover-border-color': '--tideui-hover-border-color',
  }
  for (const [name, property] of Object.entries(properties)) {
    const value = node.props[name]
    if (!value || !isValidTideStyleProperty(name, value)) continue
    styles[property] = name === 'radius' ? radius(value) : value
  }
  return styles as CSSProperties
}

export function hasTideCustomHover(node: TideNode): boolean {
  return ['hover-background', 'hover-color', 'hover-border-color'].some(name => Boolean(node.props[name]))
}
