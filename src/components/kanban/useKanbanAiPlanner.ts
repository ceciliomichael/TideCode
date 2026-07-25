import { useCallback, useEffect, useState } from 'react'
import type { KanbanTaskPlan } from '../../lib/kanban'
import {
  presentKanbanError,
  type KanbanUserFacingError,
} from './kanbanErrorPresentation'

interface UseKanbanAiPlannerInput {
  workspacePath: string | null
}

export function useKanbanAiPlanner({ workspacePath }: UseKanbanAiPlannerInput) {
  const [isEnabled, setIsEnabled] = useState(false)
  const [isPlanning, setIsPlanning] = useState(false)
  const [error, setError] = useState<KanbanUserFacingError | null>(null)

  useEffect(() => {
    let isActive = true
    void window.echosphereSettings
      .getSettings()
      .then((settings) => {
        if (isActive) {
          setIsEnabled(settings.kanbanAiPlanningEnabled)
        }
      })
      .catch((error) => {
        console.error('Failed to read AI task planning setting', error)
      })
    return () => {
      isActive = false
    }
  }, [])

  const planTask = useCallback(
    async (
      title: string,
      description: string,
    ): Promise<KanbanTaskPlan | null> => {
      if (!isEnabled || !workspacePath) {
        return null
      }

      setIsPlanning(true)
      setError(null)
      try {
        return await window.echosphereKanban.planTask({
          description,
          title,
          workspacePath,
        })
      } catch (error) {
        console.error('Failed to plan kanban task with AI', error)
        setError(presentKanbanError('plan', error))
        return null
      } finally {
        setIsPlanning(false)
      }
    },
    [isEnabled, workspacePath],
  )

  return {
    dismissError: () => setError(null),
    error,
    isEnabled,
    isPlanning,
    planTask,
  }
}
