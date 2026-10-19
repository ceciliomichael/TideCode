import type { TideNode } from './types'

/** Shared numeric interpretation for point validation and chart presentation. */
export function getTidePointValue(node: TideNode): number | null {
  const literal = node.props.value ?? node.args[1]
  if (literal === undefined || literal.trim() === '') {
    return null
  }
  const value = Number(literal)
  return Number.isFinite(value) ? value : null
}
