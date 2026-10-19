/** No file:, javascript:, data:, remote scripts, or privileged app URLs in model-authored UI. */
export function isSafeTideUrl(url: string): boolean {
  if (url.length > 2048) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}
