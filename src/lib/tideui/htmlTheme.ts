export interface TideHtmlTheme {
  mode: string
  variables: Record<string, string>
}

/** Copy presentation tokens only, never application state or document content. */
export function readTideHtmlTheme(): TideHtmlTheme {
  if (typeof document === 'undefined') return { mode: 'light', variables: {} }
  const root = document.documentElement
  const style = getComputedStyle(root)
  const variables: Record<string, string> = {}
  for (const name of Array.from(style)) {
    if (/^--(?:color|font|shadow|radius)-[\w-]+$/u.test(name)) {
      variables[name] = style.getPropertyValue(name).trim()
    }
  }
  return { mode: root.dataset.theme || 'light', variables }
}
