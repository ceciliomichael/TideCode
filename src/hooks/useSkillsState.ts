import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CreateSkillInput, SkillsState } from '../types/skills'

interface UseSkillsStateResult {
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
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallbackMessage
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
      setErrorMessage(nextState.errorMessage)
    } catch (error) {
      setErrorMessage(getErrorMessage(error, 'Unable to load skills.'))
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
          setErrorMessage(result.error)
          return false
        }

        await fetchSkills()
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
    refreshSkills: fetchSkills,
    state,
  }
}
