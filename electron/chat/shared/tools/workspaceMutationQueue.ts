import path from 'node:path'

type WorkspaceMutation<T> = () => Promise<T>

const mutationQueues = new Map<string, Promise<void>>()

function normalizeMutationKey(targetPath: string) {
  const normalizedPath = path.normalize(targetPath)
  return process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath
}

export function enqueueWorkspaceMutation<T>(targetPath: string, mutation: WorkspaceMutation<T>): Promise<T> {
  const queueKey = normalizeMutationKey(targetPath)
  const previousMutation = mutationQueues.get(queueKey) ?? Promise.resolve()
  const currentMutation = previousMutation.then(mutation)
  const completedMutation = currentMutation.then(
    () => undefined,
    () => undefined,
  )

  mutationQueues.set(queueKey, completedMutation)
  void completedMutation.then(() => {
    if (mutationQueues.get(queueKey) === completedMutation) {
      mutationQueues.delete(queueKey)
    }
  })

  return currentMutation
}

export function enqueueWorkspaceMutations<T>(targetPaths: readonly string[], mutation: WorkspaceMutation<T>): Promise<T> {
  const uniqueTargets = Array.from(
    new Map(targetPaths.map((targetPath) => [normalizeMutationKey(targetPath), targetPath])).entries(),
  )
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([, targetPath]) => targetPath)

  const acquireNext = (index: number): Promise<T> => {
    const targetPath = uniqueTargets[index]
    if (targetPath === undefined) return mutation()
    return enqueueWorkspaceMutation(targetPath, () => acquireNext(index + 1))
  }

  return acquireNext(0)
}
