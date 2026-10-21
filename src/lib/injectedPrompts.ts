import { injectedPromptTemplates } from './generatedInjectedPrompts'

export type InjectedPromptName = keyof typeof injectedPromptTemplates

/** The editor-friendly Markdown templates are embedded at build time for both
 * Electron and browser callers. Runtime state is supplied separately. */
export function renderInjectedPrompt(
  name: InjectedPromptName,
  values: Record<string, string> = {},
): string {
  const template: string = injectedPromptTemplates[name]
  const placeholders = new Set([...template.matchAll(/\{\{([A-Z][A-Z_0-9]*)\}\}/gu)].map(match => match[1]))
  for (const key of placeholders) {
    if (!(key in values)) throw new Error(`Missing ${key} for injected prompt ${name}`)
  }
  for (const key of Object.keys(values)) {
    if (!placeholders.has(key)) throw new Error(`Unexpected ${key} for injected prompt ${name}`)
  }
  return template.replace(/\{\{([A-Z][A-Z_0-9]*)\}\}/gu, (_, key: string) => values[key] ?? '')
}
