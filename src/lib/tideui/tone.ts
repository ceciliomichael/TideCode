/** Strictly map model-authored semantic tone names to existing TideCode colors. */
export function resolveTideTone(tone?: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  switch (tone?.toLowerCase()) {
    case 'success':
    case 'positive':
    case 'good':
      return 'success'
    case 'warning':
    case 'warn':
    case 'caution':
      return 'warning'
    case 'danger':
    case 'error':
    case 'negative':
      return 'danger'
    case 'info':
    case 'informational':
      return 'info'
    default:
      return 'neutral'
  }
}
