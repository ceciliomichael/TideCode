import type { StoredPlanArtifact } from '../../../plans/service'
import { createSuccessResult } from './workspaceToolResults'

export function createPlanToolResult(artifact: StoredPlanArtifact) {
  const operationLabel = artifact.operation === 'created' ? 'Created' : 'Updated'
  return createSuccessResult({
    body: `${operationLabel} ${artifact.title}.\nPlan path: ${artifact.relativePath}`,
    resultPresentation: {
      content: artifact.content,
      fileName: artifact.fileName,
      kind: 'plan',
      operation: artifact.operation,
      planId: artifact.planId,
      relativePath: artifact.relativePath,
      title: artifact.title,
      updatedAt: artifact.updatedAt,
    },
    semantics: {
      operation: artifact.operation,
      plan_id: artifact.planId,
      plan_path: artifact.relativePath,
      plan_title: artifact.title,
    },
    subject: {
      kind: 'plan',
      path: artifact.relativePath,
    },
    summary: `${operationLabel} implementation plan ${artifact.fileName}`,
  })
}
