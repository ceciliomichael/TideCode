import { useState, type ReactNode } from 'react'
import type { TideNode } from '../../lib/tideui/types'
import { MarkdownTable } from '../markdown/MarkdownTable'
import { DropdownField } from '../ui/DropdownField'
import type { TideControlContext } from './TideUIControls'

/** GFM treats cell contents as literal data, including model-authored angle brackets. */
function escapeTableCell(value: string): string {
  const encoded = value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/\r?\n/gu, ' ')
  return ['\\', '|', '`', '*', '_', '[', ']'].reduce(
    (text, character) => text.replaceAll(character, `\\${character}`),
    encoded,
  )
}

function makeTableMarkdown(headings: string[], rows: TideNode[]): string {
  const cells = (values: string[]) =>
    `| ${headings.map((_, index) => escapeTableCell(values[index] ?? '')).join(' | ')} |`
  return [
    cells(headings),
    `| ${headings.map(() => '---').join(' | ')} |`,
    ...rows.map(row => cells(row.args)),
  ].join('\n')
}

export function TideUIData({ node, children, context }: {
  node: TideNode
  children: ReactNode
  context: TideControlContext
}) {
  const [localFilter, setLocalFilter] = useState('')
  const [sort, setSort] = useState('none')
  const rows = node.kind === 'table' ? node.children.filter(item => item.kind === 'row') : []
  const headings = node.args.length ? node.args :
    Array.from({length: Math.max(1, ...rows.map(row => row.args.length))}, (_, index) => `Column ${index + 1}`)
  const filter = node.props.id ? (context.values[node.props.id] ?? localFilter) : localFilter

  if (node.kind === 'table') {
    const visible = rows.filter(row => row.args.some(cell => cell.toLowerCase().includes(filter.toLowerCase())))
    const [indexString, direction] = sort.split(':')
    const sortIndex = Number(indexString)
    const sorted = sort === 'none' ? visible : [...visible].sort((first, second) => {
      const result = (first.args[sortIndex] ?? '').localeCompare(second.args[sortIndex] ?? '', undefined, {
        numeric: true, sensitivity: 'base',
      })
      return direction === 'desc' ? -result : result
    })
    const source = makeTableMarkdown(headings, sorted)
    return <div className="tideui-markdown-table">
      <MarkdownTable content={source} />
      {!context.isStreaming && rows.length > 3 ? <div className="tideui-table-tools">
        <label className="tideui-field">
          <span>Filter rows</span>
          <input aria-label="Filter rows" className="tideui-control" value={filter}
            onChange={event => {
              setLocalFilter(event.target.value)
              if (node.props.id) context.setValue(node.props.id, event.target.value)
            }} />
        </label>
        <div className="tideui-field">
          <span>Sort rows</span>
          <DropdownField
            ariaLabel="Sort rows"
            value={sort}
            onChange={setSort}
            options={[
              {value: 'none', label: 'Original order'},
              ...headings.flatMap((heading, index) => [
                {value: `${index}:asc`, label: `${heading}: ascending`},
                {value: `${index}:desc`, label: `${heading}: descending`},
              ]),
            ]}
          />
        </div>
      </div> : null}
    </div>
  }
  if (node.kind === 'list' || node.kind === 'comparison') {
    return <div className="tideui-list">{node.children.length
      ? node.children.map((item, index) =>
          <div className="tideui-list-item" key={item.props.id || index}>{item.args.join(' · ') || item.text}</div>)
      : node.args.map((value, index) =>
          <div className="tideui-list-item" key={index}>{value}</div>)}</div>
  }
  return <>{children}</>
}
