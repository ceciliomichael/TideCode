export interface PlanRuntimeState {
  activePlanPath: string | null
  enabled: boolean
  isCreatingPlan: boolean
}

export function createPlanRuntimeState(enabled: boolean, activePlanPath?: string | null): PlanRuntimeState {
  return {
    activePlanPath: activePlanPath?.trim() || null,
    enabled,
    isCreatingPlan: false,
  }
}
