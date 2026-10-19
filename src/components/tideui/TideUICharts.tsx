import { useState } from 'react'
import type { TideNode } from '../../lib/tideui/types'
import { getTidePointValue } from '../../lib/tideui/pointValue'
import { AnchoredTooltip, type AnchoredTooltipRect } from '../Tooltip'

const WIDTH = 400
const HEIGHT = 180
const PADDING = 28
const PALETTE = ['#438a7e', '#6b8fbd', '#d5a65c', '#ba7c95', '#7e75a8', '#78a07a']

export function TideUICharts({ node }: { node: TideNode }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [hoverRect, setHoverRect] = useState<AnchoredTooltipRect | null>(null)
  const points = node.children
    .filter(child => child.kind === 'point')
    .slice(0, 60)
    .flatMap(child => {
      const value = getTidePointValue(child)
      if (value === null) {
        return []
      }
      return [{ label: child.args[0] || '', value }]
    })
  const chartType = node.kind === 'sparkline' ? 'line' : (node.args[0] || 'line')
  const title = node.kind === 'chart' ? node.args[1] : node.args[0]
  const interactive = node.props.interactive === 'true'
  const activeIndex = hovered ?? selected
  const active = activeIndex === null ? null : points[activeIndex] ?? null
  const showHover = (index: number, element: SVGGElement) => {
    const bounds = element.getBoundingClientRect()
    setHoverRect({
      left: bounds.left, right: bounds.right, top: bounds.top,
      bottom: bounds.bottom, width: bounds.width, height: bounds.height,
    })
    setHovered(index)
  }
  const hideHover = () => {
    setHovered(null)
    setHoverRect(null)
  }

  const markInteractions = (index: number) => ({
    tabIndex: 0,
    role: interactive ? 'button' : 'img',
    'aria-label': `${points[index].label}: ${points[index].value}`,
    className: 'tideui-chart-mark',
    onMouseEnter: (event: React.MouseEvent<SVGGElement>) => showHover(index, event.currentTarget),
    onMouseLeave: hideHover,
    onFocus: (event: React.FocusEvent<SVGGElement>) => showHover(index, event.currentTarget),
    onBlur: hideHover,
    onClick: () => { if (interactive) setSelected(current => current === index ? null : index) },
    onKeyDown: (event: React.KeyboardEvent<SVGGElement>) => {
      if (interactive && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault()
        setSelected(current => current === index ? null : index)
      }
    },
  })

  const detail = <div className="tideui-chart-detail" aria-live="polite">
    {active ? `${active.label}: ${active.value}` : points.length ? 'Hover or focus a data point to inspect it.' : 'Waiting for chart data.'}
    {interactive && selected !== null && selected === activeIndex ? ' (selected)' : ''}
  </div>
  const max = Math.max(1, ...points.map(point => point.value))
  const min = Math.min(0, ...points.map(point => point.value))
  const bottom = HEIGHT - PADDING
  const plotHeight = HEIGHT - PADDING * 2
  const scaleY = (value: number) => PADDING + (max - value) / (max - min || 1) * plotHeight
  const positions = points.map((point, index) => ({
    x: PADDING + (WIDTH - PADDING * 2) * index / Math.max(1, points.length - 1),
    y: scaleY(point.value),
  }))
  const line = positions.map(({ x, y }, index) => `${index ? 'L' : 'M'}${x} ${y}`).join(' ')
  if (chartType === 'pie') {
    const total = points.reduce((sum, point) => sum + Math.max(0, point.value), 0)
    let offset = 0
    return <figure className="tideui-figure">
      {title ? <figcaption className="tideui-heading">{title}</figcaption> : null}
      <div className="tideui-pie-row">
        <svg className="tideui-pie" role="img" aria-label={title || 'Pie chart'} viewBox="0 0 120 120">
          {total > 0 ? points.map((point, index) => {
            const share = Math.max(0, point.value) / total
            const start = offset
            offset += share
            if (!share) return null
            const from = Math.PI * 2 * start - Math.PI / 2
            const to = Math.PI * 2 * (offset - (share === 1 ? .000001 : 0)) - Math.PI / 2
            const x1 = 60 + Math.cos(from) * 51
            const y1 = 60 + Math.sin(from) * 51
            const x2 = 60 + Math.cos(to) * 51
            const y2 = 60 + Math.sin(to) * 51
            return <g key={index} {...markInteractions(index)}>
              <title>{`${point.label}: ${point.value}`}</title>
              <path className="tideui-chart-shape" d={`M60 60 L${x1} ${y1} A51 51 0 ${share > .5 ? 1 : 0} 1 ${x2} ${y2} Z`}
                fill={PALETTE[index % PALETTE.length]}/>
            </g>
          }) : null}
        </svg>
        <div className="tideui-legend">{points.map((point, i) => <div key={i}>{point.label}: {point.value}</div>)}</div>
      </div>
      <AnchoredTooltip anchorElement={null} anchorRect={hoverRect}
        content={hovered !== null ? `${points[hovered]?.label}: ${points[hovered]?.value}` : ''}
        visible={hovered !== null} side="top" noWrap />
      {detail}
    </figure>
  }
  return <figure className="tideui-figure">
    {title ? <figcaption className="tideui-heading">{title}</figcaption> : null}
    <svg className="tideui-chart" role="img" aria-label={title || 'Chart'} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
      <line x1={PADDING} y1={bottom} x2={WIDTH - PADDING} y2={bottom} stroke="currentColor" opacity=".25"/>
      {chartType === 'bar' || chartType === 'bars'
        ? positions.map(({ x, y }, i) => <g key={i} {...markInteractions(i)}>
          <title>{`${points[i].label}: ${points[i].value}`}</title>
          <rect className="tideui-chart-shape" x={x - Math.min(20, WIDTH / points.length / 3)}
            y={y} width={Math.min(40, WIDTH / points.length * .65)}
            height={Math.max(0, bottom - y)} rx="3" fill="var(--color-brand)"/>
        </g>)
        : <>
          <path d={line} stroke="var(--color-brand)" strokeWidth="3" fill="none" strokeLinejoin="round" strokeLinecap="round"/>
          {positions.map(({ x, y }, i) => <g key={i} {...markInteractions(i)}>
            <title>{`${points[i].label}: ${points[i].value}`}</title>
            <circle className="tideui-chart-shape tideui-chart-dot" cx={x} cy={y} r="5" fill="var(--color-brand)"/>
          </g>)}
        </>}
      {points.map((point, i) => i % Math.max(1, Math.ceil(points.length / 5)) === 0
        ? <text key={i} x={positions[i].x} y={HEIGHT - 7} textAnchor="middle" fontSize="11" fill="currentColor">
          {point.label.slice(0, 9)}</text> : null)}
    </svg>
    <AnchoredTooltip anchorElement={null} anchorRect={hoverRect}
      content={hovered !== null ? `${points[hovered]?.label}: ${points[hovered]?.value}` : ''}
      visible={hovered !== null} side="top" noWrap />
    {detail}
  </figure>
}
