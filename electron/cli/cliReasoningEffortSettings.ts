import type { AppSettings, ReasoningEffort } from '../../src/types/chat'
import { updateStoredSettings } from '../settings/store'
import type { CliSessionState } from './types'

export function buildCliReasoningEffortSettingsUpdate(effort: ReasoningEffort): Partial<AppSettings> {
  return { chatReasoningEffort: effort }
}

export async function persistCliReasoningEffort(
  state: CliSessionState,
  effort: ReasoningEffort,
): Promise<void> {
  await updateStoredSettings(buildCliReasoningEffortSettingsUpdate(effort), 'cli')
  state.reasoningEffort = effort
}
