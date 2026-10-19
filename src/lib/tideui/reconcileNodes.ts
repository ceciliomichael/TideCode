import type { TideNode } from './types'

/** Retain unchanged branches so appending declarations does not redraw them. */
export function reconcileTideNodes(previous: TideNode[], incoming: TideNode[]): TideNode[] {
  const previousByLine = new Map(previous.map(node => [node.line, node]))
  const nodes = incoming.map(node => {
    const existing = previousByLine.get(node.line)
    if (!existing || existing.kind !== node.kind) {
      return node
    }

    const children = reconcileTideNodes(existing.children, node.children)
    const sameArgs = existing.args.length === node.args.length &&
      existing.args.every((argument, index) => argument === node.args[index])
    const propNames = Object.keys(node.props)
    const sameProps = Object.keys(existing.props).length === propNames.length &&
      propNames.every(name => existing.props[name] === node.props[name])
    if (sameArgs && sameProps && existing.text === node.text && children === existing.children) {
      return existing
    }
    return { ...node, children }
  })

  if (nodes.length === previous.length && nodes.every((node, index) => node === previous[index])) {
    return previous
  }
  return nodes
}
