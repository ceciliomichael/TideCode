export function normalizeRemoteBrowserUrl(value: string) {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('Remote browser URL must be a valid HTTP or HTTPS URL.')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Remote browser navigation supports only HTTP and HTTPS URLs.')
  }
  return parsed.toString()
}
