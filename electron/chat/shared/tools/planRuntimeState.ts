export interface PlanRuntimeState {
  activePlanPath: string | null
  isCreatingPlan: boolean
  planMode: boolean
}

export function createPlanRuntimeState(planMode: boolean, activePlanPath?: string | null): PlanRuntimeState {
  return {
    activePlanPath: activePlanPath?.trim() || null,
    isCreatingPlan: false,
    planMode,
  }
}
