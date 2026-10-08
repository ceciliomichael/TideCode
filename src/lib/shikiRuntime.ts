import type { BundledLanguage, Highlighter } from 'shiki/bundle/full'

let runtimePromise: Promise<Highlighter> | null = null
const languageLoads = new Map<string, Promise<void>>()

export function getShikiRuntime(): Promise<Highlighter> {
  if (!runtimePromise) {
    runtimePromise = import('shiki/bundle/full').then(({ createHighlighter }) => createHighlighter({
      langs: [],
      themes: ['github-light-default', 'github-dark-default'],
    })).catch((error: unknown) => {
      runtimePromise = null
      throw error
    })
  }
  return runtimePromise
}

export async function loadShikiLanguage(language: BundledLanguage | 'text') {
  const highlighter = await getShikiRuntime()
  if (language === 'text' || highlighter.getLoadedLanguages().includes(language)) {
    return highlighter
  }
  let load = languageLoads.get(language)
  if (!load) {
    load = highlighter.loadLanguage(language).finally(() => languageLoads.delete(language))
    languageLoads.set(language, load)
  }
  await load
  return highlighter
}
