import { PLAN_HANDOFF_SUCCESS_LABEL } from '../../lib/planStatusMessages'
import { PlanStatusDivider } from './PlanStatusDivider'

export function PlanImplementationDivider() {
  return <PlanStatusDivider label={PLAN_HANDOFF_SUCCESS_LABEL} />
}
