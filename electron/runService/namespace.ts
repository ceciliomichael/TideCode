import { createHash } from 'node:crypto'
import path from 'node:path'

export const RUN_SERVICE_NAMESPACE_ENV = 'TIDECODE_RUN_SERVICE_NAMESPACE'

const RUN_SERVICE_NAMESPACE_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/u

function normalizeRuntimeRoot(runtimeRoot: string, platform: NodeJS.Platform) {
  const resolvedRoot = path.resolve(runtimeRoot)
  return platform === 'win32' ? resolvedRoot.toLowerCase() : resolvedRoot
}

export function createDevelopmentRunServiceNamespace(
  runtimeRoot: string,
  platform: NodeJS.Platform = process.platform,
) {
  const runtimeKey = createHash('sha256')
    .update('tidecode-development-run-service/v1\0')
    .update(normalizeRuntimeRoot(runtimeRoot, platform))
    .digest('hex')
    .slice(0, 16)
  return `dev-${runtimeKey}`
}

export function resolveRunServiceNamespace(environment: NodeJS.ProcessEnv = process.env) {
  const configuredNamespace = environment[RUN_SERVICE_NAMESPACE_ENV]?.trim().toLowerCase()
  if (!configuredNamespace) return null
  if (!RUN_SERVICE_NAMESPACE_PATTERN.test(configuredNamespace)) {
    throw new Error(
      `${RUN_SERVICE_NAMESPACE_ENV} must contain 1-64 lowercase letters, numbers, underscores, or hyphens.`,
    )
  }
  return configuredNamespace
}

export function configureDevelopmentRunServiceNamespace(
  runtimeRoot: string,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
) {
  const configuredNamespace = resolveRunServiceNamespace(environment)
  if (configuredNamespace) return configuredNamespace

  const developmentNamespace = createDevelopmentRunServiceNamespace(runtimeRoot, platform)
  environment[RUN_SERVICE_NAMESPACE_ENV] = developmentNamespace
  return developmentNamespace
}
