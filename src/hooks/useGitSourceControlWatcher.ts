import { useEffect } from 'react'
import { normalizeGitWorkspacePath } from '../lib/gitBranchStateCache'

export function useGitSourceControlWatcher(workspacePath: string | null | undefined) {
  const normalizedWorkspacePath = normalizeGitWorkspacePath(workspacePath)

  useEffect(() => {
    if (!normalizedWorkspacePath) {
      return
    }

    void window.tidecodeGit.watchSourceControlChanges({
      workspacePath: normalizedWorkspacePath,
    }).catch((error: unknown) => {
      console.error('Failed to start source-control file watching', error)
    })

    return () => {
      void window.tidecodeGit.unwatchSourceControlChanges({
        workspacePath: normalizedWorkspacePath,
      }).catch((error: unknown) => {
        console.error('Failed to stop source-control file watching', error)
      })
    }
  }, [normalizedWorkspacePath])
}
