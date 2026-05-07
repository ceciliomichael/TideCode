export function formatChatDuration(seconds: number) {
  const normalizedSeconds = Math.max(0, Math.round(seconds))
  const hours = Math.floor(normalizedSeconds / 3600)
  const minutes = Math.floor((normalizedSeconds % 3600) / 60)
  const remainingSeconds = normalizedSeconds % 60

  const parts: string[] = []
  if (hours > 0) {
    parts.push(`${hours}h`)
  }
  if (hours > 0 || minutes > 0) {
    parts.push(`${minutes}m`)
  }
  parts.push(`${remainingSeconds}s`)

  return parts.join(' ')
}
