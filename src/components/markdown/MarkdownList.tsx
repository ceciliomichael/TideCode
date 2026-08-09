import { Children, type ComponentPropsWithoutRef, type CSSProperties, type ReactNode } from 'react'

interface MarkdownOrderedListProps extends ComponentPropsWithoutRef<'ol'> {
  node?: unknown
}

interface MarkdownListItemProps extends ComponentPropsWithoutRef<'li'> {
  node?: unknown
}

type MarkdownOrderedListStyle = CSSProperties & {
  '--markdown-ordered-list-counter-start'?: number
  '--markdown-ordered-list-marker-digits'?: number
}

function isSafeInteger(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value)
}

function getNumberCharacterCount(value: number) {
  const absoluteValueLength = Math.max(1, Math.abs(value).toString().length)
  return absoluteValueLength + (value < 0 ? 1 : 0)
}

function getMarkerDigitCount(start: number, itemCount: number) {
  const lastNumber = start + Math.max(0, itemCount - 1)
  const safeLastNumber = Number.isSafeInteger(lastNumber) ? lastNumber : start
  return Math.max(getNumberCharacterCount(start), getNumberCharacterCount(safeLastNumber))
}

function mergeClassNames(...classNames: Array<string | undefined>) {
  return classNames.filter((className) => className && className.length > 0).join(' ')
}

function getNodeChildCount(node: unknown) {
  if (!node || typeof node !== 'object') {
    return undefined
  }

  const nodeChildren = (node as { children?: unknown }).children
  if (!Array.isArray(nodeChildren) || nodeChildren.length === 0) {
    return undefined
  }

  const listItemCount = nodeChildren.filter((child) => {
    if (!child || typeof child !== 'object') {
      return false
    }

    const childNode = child as { tagName?: unknown; type?: unknown }
    return childNode.tagName === 'li' || childNode.type === 'listItem'
  }).length

  return listItemCount > 0 ? listItemCount : nodeChildren.length
}

export function MarkdownOrderedList({
  children,
  className,
  node: _node,
  start,
  style,
  ...props
}: MarkdownOrderedListProps) {
  const normalizedStart = isSafeInteger(start) ? start : 1
  const itemCount = getNodeChildCount(_node) ?? Math.max(1, Children.count(children))
  const markerDigits = getMarkerDigitCount(normalizedStart, itemCount)
  const orderedListStyle: MarkdownOrderedListStyle = {
    ...style,
    '--markdown-ordered-list-counter-start': normalizedStart - 1,
    '--markdown-ordered-list-marker-digits': markerDigits,
  }

  return (
    <ol
      {...props}
      start={start}
      style={orderedListStyle}
      className={mergeClassNames('markdown-ordered-list list-none pl-0', className)}
    >
      {children}
    </ol>
  )
}

export function MarkdownListItem({
  className,
  node,
  children,
  ...props
}: MarkdownListItemProps & { children?: ReactNode }) {
  void node

  return (
    <li
      {...props}
      className={mergeClassNames(
        'markdown-list-item my-0 leading-[1.6] [&>.markdown-list-item-content>p]:my-0 [&>.markdown-list-item-content>p]:mb-0 [&>.markdown-list-item-content>p+p]:mt-1',
        className,
      )}
    >
      <div className="markdown-list-item-content">
        {children}
      </div>
    </li>
  )
}
