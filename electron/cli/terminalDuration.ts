export function formatThoughtDuration(seconds: number): string {
  const normalizedSeconds = Math.max(seconds, 0.01)

  if (normalizedSeconds >= 60) {
    const minutes = Math.floor(normalizedSeconds / 60)
    const remainingSeconds = Math.round(normalizedSeconds % 60)
    return `${minutes}m ${remainingSeconds}s`
  }

  return `${normalizedSeconds.toFixed(normalizedSeconds < 1 ? 2 : 1)}s`
}
