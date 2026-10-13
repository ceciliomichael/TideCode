import type { ReactNode } from 'react'
import type { GraphNode, HistoryItemViewModel } from './historyGraphLayout'

const SWIMLANE_WIDTH = 11
const SWIMLANE_HEIGHT = 50
const SWIMLANE_CURVE_RADIUS = 5
const CIRCLE_RADIUS = 4
const CIRCLE_STROKE_WIDTH = 2
const GRAPH_LANE_COLORS = ['#FFB000', '#DC267F', '#994F00', '#40B0A6', '#B66DFF', '#4ea1ff'] as const

export function GitGraphLane({ viewModel }: { viewModel: HistoryItemViewModel }) {
  const { entry, inputSwimlanes, outputSwimlanes, kind } = viewModel

  const inputIndex = inputSwimlanes.findIndex((node) => node.id === entry.hash)
  const circleIndex = inputIndex !== -1 ? inputIndex : inputSwimlanes.length
  const circleColor = inputIndex !== -1
    ? inputSwimlanes[inputIndex].color
    : outputSwimlanes.find((node) => node.id === entry.parentIds[0])?.color ?? GRAPH_LANE_COLORS[0]

  const svgElements: ReactNode[] = []
  const halfHeight = SWIMLANE_HEIGHT / 2

  for (let index = 0; index < inputSwimlanes.length; index++) {
    const color = inputSwimlanes[index].color
    const x1 = SWIMLANE_WIDTH * (index + 1)

    if (inputSwimlanes[index].id === entry.hash) {
      svgElements.push(
        <line key={`in-${index}`} x1={x1} y1={0} x2={x1} y2={halfHeight} stroke={color} strokeWidth={1} strokeLinecap="round" />,
      )
      continue
    }

    const nextIndex = outputSwimlanes.findIndex((node) => node.id === inputSwimlanes[index].id)
    if (nextIndex === -1) {
      continue
    }

    const x2 = SWIMLANE_WIDTH * (nextIndex + 1)
    if (x1 === x2) {
      svgElements.push(
        <line key={`str-${index}`} x1={x1} y1={0} x2={x2} y2={SWIMLANE_HEIGHT} stroke={color} strokeWidth={1} strokeLinecap="round" />,
      )
    } else {
      const r = SWIMLANE_CURVE_RADIUS
      svgElements.push(
        <path
          key={`shift-${index}`}
          d={`M ${x1} 0 V ${halfHeight - r} C ${x1} ${halfHeight} ${x2} ${halfHeight} ${x2} ${halfHeight + r} V ${SWIMLANE_HEIGHT}`}
          stroke={color}
          strokeWidth={1}
          strokeLinecap="round"
          fill="none"
        />,
      )
    }
  }

  for (const [index, parentId] of entry.parentIds.entries()) {
    const parentOutputIndex = outputSwimlanes.findIndex((node) => node.id === parentId)
    if (parentOutputIndex === -1) {
      continue
    }

    const parentColor = outputSwimlanes[parentOutputIndex].color
    const parentX = SWIMLANE_WIDTH * (parentOutputIndex + 1)
    const circleX = SWIMLANE_WIDTH * (circleIndex + 1)
    if (parentX === circleX) {
      svgElements.push(
        <line key={`par-${index}`} x1={circleX} y1={halfHeight} x2={parentX} y2={SWIMLANE_HEIGHT} stroke={parentColor} strokeWidth={1} strokeLinecap="round" />,
      )
    } else {
      const controlY = halfHeight + SWIMLANE_CURVE_RADIUS + 1
      svgElements.push(
        <path
          key={`par-${index}`}
          d={`M ${circleX} ${halfHeight} C ${circleX} ${controlY} ${parentX} ${controlY} ${parentX} ${SWIMLANE_HEIGHT}`}
          stroke={parentColor}
          strokeWidth={1}
          strokeLinecap="round"
          fill="none"
        />,
      )
    }
  }

  const nodeX = SWIMLANE_WIDTH * (circleIndex + 1)
  const nodeY = SWIMLANE_HEIGHT / 2

  if (kind === 'HEAD') {
    svgElements.push(
      <circle
        key="co"
        cx={nodeX}
        cy={nodeY}
        r={CIRCLE_RADIUS + 3}
        fill={circleColor}
        stroke="var(--workspace-panel-surface)"
        strokeWidth={CIRCLE_STROKE_WIDTH}
      />,
      <circle key="ci" cx={nodeX} cy={nodeY} r={CIRCLE_STROKE_WIDTH} fill="var(--workspace-panel-surface)" />,
    )
  } else if (entry.parentIds.length > 1) {
    svgElements.push(
      <circle
        key="co"
        cx={nodeX}
        cy={nodeY}
        r={CIRCLE_RADIUS + 2}
        fill={circleColor}
        stroke="var(--workspace-panel-surface)"
        strokeWidth={CIRCLE_STROKE_WIDTH}
      />,
      <circle key="ci" cx={nodeX} cy={nodeY} r={CIRCLE_RADIUS - 1} fill={circleColor} />,
    )
  } else {
    svgElements.push(
      <circle
        key="cn"
        cx={nodeX}
        cy={nodeY}
        r={CIRCLE_RADIUS + 1}
        fill={circleColor}
        stroke="var(--workspace-panel-surface)"
        strokeWidth={CIRCLE_STROKE_WIDTH}
      />,
    )
  }

  const totalLanes = Math.max(inputSwimlanes.length, outputSwimlanes.length, circleIndex + 1) + 1
  const svgWidth = SWIMLANE_WIDTH * totalLanes

  return (
    <svg width={svgWidth} height={SWIMLANE_HEIGHT} viewBox={`0 0 ${svgWidth} ${SWIMLANE_HEIGHT}`} className="shrink-0">
      {svgElements}
    </svg>
  )
}

export function GitGraphPlaceholder({ columns }: { columns: GraphNode[] }) {
  if (columns.length === 0) {
    return null
  }

  const svgWidth = SWIMLANE_WIDTH * (columns.length + 1)
  return (
    <svg width={svgWidth} height="100%" className="shrink-0" style={{ minHeight: SWIMLANE_HEIGHT }}>
      {columns.map((column, index) => (
        <line
          key={column.id + index}
          x1={SWIMLANE_WIDTH * (index + 1)}
          y1={0}
          x2={SWIMLANE_WIDTH * (index + 1)}
          y2="100%"
          stroke={column.color}
          strokeWidth={1}
          strokeLinecap="round"
        />
      ))}
    </svg>
  )
}
