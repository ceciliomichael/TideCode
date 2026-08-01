import type { AppSettings } from '../types/chat'

export function shouldDeferRendererSettingsCommit(input: Partial<AppSettings>): boolean {
  return input.appearance !== undefined
}
