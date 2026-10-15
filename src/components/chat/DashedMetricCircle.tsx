interface DashedMetricCircleProps {
  activeColor?: string
  inactiveColor?: string
  percent: number
  size?: number
  strokeWidth?: number
}

function buildDashPath(size: number, dashIndex: number, dashCount: number, strokeWidth: number) {
  const radius = (size - strokeWidth) / 2
  const center = size / 2
  const anglePerDash = 360 / dashCount
  const dashArcAngle = anglePerDash * 0.58
  const startAngle = dashIndex * anglePerDash - 90
  const endAngle = startAngle + dashArcAngle
  const startRadians = (startAngle * Math.PI) / 180
  const endRadians = (endAngle * Math.PI) / 180
  const startX = center + radius * Math.cos(startRadians)
  const startY = center + radius * Math.sin(startRadians)
  const endX = center + radius * Math.cos(endRadians)
  const endY = center + radius * Math.sin(endRadians)

  return `M ${startX} ${startY} A ${radius} ${radius} 0 0 1 ${endX} ${endY}`
}

export function DashedMetricCircle({
  activeColor = 'currentColor',
  inactiveColor = 'var(--color-border)',
  percent,
  size = 18,
  strokeWidth = 1.5,
}: DashedMetricCircleProps) {
  const dashCount = 8
  const activeDashCount = Math.min(dashCount, Math.ceil((Math.min(Math.max(percent, 0), 100) / 100) * dashCount))

  return (
    <svg aria-hidden="true" height={size} viewBox={`0 0 ${size} ${size}`} width={size}>
      {Array.from({ length: dashCount }, (_, dashIndex) => {
        const isActive = dashIndex < activeDashCount
        return (
          <path
            key={dashIndex}
            d={buildDashPath(size, dashIndex, dashCount, strokeWidth)}
            fill="none"
            stroke={isActive ? activeColor : inactiveColor}
            strokeLinecap="round"
            strokeWidth={strokeWidth}
          />
        )
      })}
    </svg>
  )
}
