import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { toUserFacingErrorMessage } from '../lib/userFacingError'
import type { CreateSkillInput, SkillsState } from '../types/skills'
import { getCachedSkillsState, requestSkillsState } from './skillsStateCache'

export interface UseSkillsStateResult {
  createSkill: (input: CreateSkillInput) => Promise<boolean>
  errorMessage: string | null
  isLoading: boolean
  refreshSkills: () => Promise<void>
  state: SkillsState | null
}

function normalizeWorkspacePath(workspacePath?: string | null) {
  const trimmed = workspacePath?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

function getSkillsApi() {
  return typeof window !== 'undefined' ? window.tidecodeSkills : null
}

function getErrorMessage(error: unknown, fallbackMessage: string) {
  return toUserFacingErrorMessage(error, fallbackMessage)
}

function getStateErrorMessage(state: SkillsState | null) {
  return state?.errorMessage
    ? toUserFacingErrorMessage(state.errorMessage, 'Unable to load skills.')
    : null
}

export function useSkillsState(workspacePath?: string | null): UseSkillsStateResult {
  const normalizedWorkspacePath = useMemo(() => normalizeWorkspacePath(workspacePath), [workspacePath])
  const initialState = getCachedSkillsState(normalizedWorkspacePath)
  const [state, setState] = useState<SkillsState | null>(initialState)
  const [isLoading, setIsLoading] = useState(initialState === null)
  const [errorMessage, setErrorMessage] = useState<string | null>(() => getStateErrorMessage(initialState))
  const requestVersionRef = useRef(0)

  useLayoutEffect(() => {
    requestVersionRef.current += 1
    const cachedState = getCachedSkillsState(normalizedWorkspacePath)
    setState(cachedState)
    setErrorMessage(getStateErrorMessage(cachedState))
    setIsLoading(cachedState === null)
  }, [normalizedWorkspacePath])

  const fetchSkills = useCallback(async (force = false) => {
    const requestVersion = ++requestVersionRef.current
    const api = getSkillsApi()
    if (!api) {
      if (requestVersion !== requestVersionRef.current) return
      setState(null)
      setIsLoading(false)
      setErrorMessage('Skills are unavailable in this renderer.')
      return
    }

    setIsLoading(true)
    if (!getCachedSkillsState(normalizedWorkspacePath)) setErrorMessage(null)

    try {
      const nextState = await requestSkillsState(api, normalizedWorkspacePath, { force })
      if (requestVersion !== requestVersionRef.current) return
      setState(nextState)
      setErrorMessage(getStateErrorMessage(nextState))
    } catch (error) {
      if (requestVersion !== requestVersionRef.current) return
      setErrorMessage(getErrorMessage(error, 'Unable to load skills.'))
    } finally {
      if (requestVersion === requestVersionRef.current) setIsLoading(false)
    }
  }, [normalizedWorkspacePath])

  useEffect(() => {
    void fetchSkills()
    return () => {
      requestVersionRef.current += 1
    }
  }, [fetchSkills])

  const createSkill = useCallback(
    async (input: CreateSkillInput) => {
      const api = getSkillsApi()
      if (!api) {
        setErrorMessage('Skills API is unavailable.')
        return false
      }

      try {
        const result = await api.createSkill(input, normalizedWorkspacePath)
        if (result.error) {
          setErrorMessage(toUserFacingErrorMessage(result.error, 'The skill could not be created.'))
          return false
        }

        await fetchSkills(true)
        return true
      } catch (error) {
        setErrorMessage(getErrorMessage(error, 'Failed to create skill.'))
        return false
      }
    },
    [fetchSkills, normalizedWorkspacePath],
  )

  return {
    createSkill,
    errorMessage,
    isLoading,
    refreshSkills: () => fetchSkills(true),
    state,
  }
}
