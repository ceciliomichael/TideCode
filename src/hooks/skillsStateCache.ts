import type { SkillsState, TideCodeSkillsApi } from '../types/skills'

const cachedStates = new Map<string, SkillsState>()
const inFlightRequests = new Map<string, Promise<SkillsState>>()
const requestGenerations = new Map<string, number>()

export function getSkillsWorkspaceKey(workspacePath?: string | null) {
  return workspacePath?.trim() ?? ''
}

export function getCachedSkillsState(workspacePath?: string | null) {
  return cachedStates.get(getSkillsWorkspaceKey(workspacePath)) ?? null
}

export function requestSkillsState(
  api: TideCodeSkillsApi,
  workspacePath?: string | null,
  options: { force?: boolean } = {},
) {
  const cacheKey = getSkillsWorkspaceKey(workspacePath)
  const activeRequest = inFlightRequests.get(cacheKey)
  if (activeRequest && !options.force) return activeRequest

  const generation = (requestGenerations.get(cacheKey) ?? 0) + 1
  requestGenerations.set(cacheKey, generation)

  const request = api.listSkills(workspacePath)
    .then((state) => {
      if (requestGenerations.get(cacheKey) === generation) {
        cachedStates.set(cacheKey, state)
      }
      return state
    })
    .finally(() => {
      if (inFlightRequests.get(cacheKey) === request) {
        inFlightRequests.delete(cacheKey)
      }
    })

  inFlightRequests.set(cacheKey, request)
  return request
}
