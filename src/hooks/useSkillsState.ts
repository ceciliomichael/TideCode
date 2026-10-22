import { useCallback, useEffect, useMemo, useState } from 'react'
import { resolveAppError } from '../lib/errors/resolveAppError'
import type { AppErrorId } from '../lib/errors/errorCatalog'
import type { CreateSkillInput, SkillSummary, SkillsState } from '../types/skills'

export interface UseSkillsStateResult {
  createSkill: (input: CreateSkillInput) => Promise<boolean>
  errorMessage: string | null
  isLoading: boolean
  loadSkill: (skill: SkillSummary) => Promise<CreateSkillInput | null>
  refreshSkills: () => Promise<void>
  state: SkillsState | null
  updateSkill: (skill: SkillSummary, input: CreateSkillInput) => Promise<boolean>
}

function normalizeWorkspacePath(workspacePath?: string | null) {
  const trimmed = workspacePath?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

function getSkillsApi() {
  return typeof window !== 'undefined' ? window.tidecodeSkills : null
}

function getErrorMessage(error: unknown, operation: AppErrorId) {
  return resolveAppError(error, operation).message
}

export function useSkillsState(workspacePath?: string | null): UseSkillsStateResult {
  const normalizedWorkspacePath = useMemo(() => normalizeWorkspacePath(workspacePath), [workspacePath])
  const [state, setState] = useState<SkillsState | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const fetchSkills = useCallback(async () => {
    const api = getSkillsApi()
    if (!api) {
      setState(null)
      setIsLoading(false)
      setErrorMessage('Skills are unavailable in this renderer.')
      return
    }

    setIsLoading(true)
    setErrorMessage(null)

    try {
      const nextState = await api.listSkills(normalizedWorkspacePath)
      setState(nextState)
      setErrorMessage(
        nextState.errorMessage
          ? getErrorMessage(nextState.errorMessage, 'skill.load')
          : null,
      )
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'skill.load'))
    } finally {
      setIsLoading(false)
    }
  }, [normalizedWorkspacePath])

  useEffect(() => {
    void fetchSkills()
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
          setErrorMessage(getErrorMessage(result.error, 'skill.save'))
          return false
        }

        await fetchSkills()
        return true
      } catch (error) {
        setErrorMessage(getErrorMessage(error, 'skill.save'))
        return false
      }
    },
    [fetchSkills, normalizedWorkspacePath],
  )

  const loadSkill = useCallback(
    async (skill: SkillSummary) => {
      const api = getSkillsApi()
      if (!api) {
        setErrorMessage('Skills API is unavailable.')
        return null
      }

      try {
        const result = await api.loadSkill(skill.name, normalizedWorkspacePath)
        if (result.error || !result.skill) {
          setErrorMessage(getErrorMessage(result.error, 'skill.load'))
          return null
        }

        return {
          content: result.skill.content,
          description: result.skill.description,
          name: result.skill.name,
        }
      } catch (error) {
        setErrorMessage(getErrorMessage(error, 'skill.load'))
        return null
      }
    },
    [normalizedWorkspacePath],
  )

  const updateSkill = useCallback(
    async (skill: SkillSummary, input: CreateSkillInput) => {
      const api = getSkillsApi()
      if (!api) {
        setErrorMessage('Skills API is unavailable.')
        return false
      }

      try {
        const result = await api.updateSkill(skill.location, input, normalizedWorkspacePath)
        if (result.error) {
          setErrorMessage(getErrorMessage(result.error, 'skill.save'))
          return false
        }

        await fetchSkills()
        return true
      } catch (error) {
        setErrorMessage(getErrorMessage(error, 'skill.save'))
        return false
      }
    },
    [fetchSkills, normalizedWorkspacePath],
  )

  return {
    createSkill,
    errorMessage,
    isLoading,
    loadSkill,
    refreshSkills: fetchSkills,
    state,
    updateSkill,
  }
}
