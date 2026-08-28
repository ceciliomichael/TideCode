import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getSafeWorkspaceTargetPath } from '../../workspace/paths'
import { retryTransientFilesystemOperation, writeTextFileAtomically } from './tools/workspaceMutationSafety'
import { enqueueWorkspaceMutations } from './tools/workspaceMutationQueue'
import { applyUpdateChunks, normalizeContentLineEndings } from './applyPatchMatcher'
import { parseApplyPatch } from './applyPatchParser'
import type {
  ApplyPatchChange,
  ApplyPatchTargetPath,
  ApplyPatchWorkspaceOptions,
} from './applyPatchTypes'

interface StagedFileState {
  content: string | null
  target: ApplyPatchTargetPath
}

interface FileSnapshot {
  absolutePath: string
  content: string | null
  existed: boolean
}

function resolvePatchTargetPath(
  workspaceRootPath: string,
  candidatePath: string,
  customResolver: ApplyPatchWorkspaceOptions['resolveTargetPath'],
  basePath: string,
) {
  if (customResolver) return customResolver(candidatePath)

  if (path.isAbsolute(candidatePath)) {
    const relativePath = path.relative(workspaceRootPath, candidatePath)
    return getSafeWorkspaceTargetPath(workspaceRootPath, relativePath)
  }

  const resolvedCandidatePath = path.resolve(basePath, candidatePath)
  return getSafeWorkspaceTargetPath(
    workspaceRootPath,
    path.relative(workspaceRootPath, resolvedCandidatePath),
  )
}

export async function applyPatchInWorkspace(
  workspaceRootPath: string,
  patchText: string,
  options?: ApplyPatchWorkspaceOptions,
) {
  const parsedPatch = parseApplyPatch(patchText)
  const changes: ApplyPatchChange[] = []
  const stagedFiles = new Map<string, StagedFileState>()
  const basePath = options?.basePath ? path.resolve(options.basePath) : workspaceRootPath
  const resolveTargetPath = (candidatePath: string) =>
    resolvePatchTargetPath(
      workspaceRootPath,
      candidatePath,
      options?.resolveTargetPath,
      basePath,
    )
  const mutationTargetPaths = parsedPatch.hunks.flatMap((hunk) => {
    const sourcePath = resolveTargetPath(hunk.path).absolutePath
    if (hunk.type === 'update' && hunk.movePath) {
      return [sourcePath, resolveTargetPath(hunk.movePath).absolutePath]
    }
    return [sourcePath]
  })

  return enqueueWorkspaceMutations(mutationTargetPaths, async () => {
  const readRequiredContent = async (
    target: ApplyPatchTargetPath,
    operation: 'deletion' | 'update',
  ) => {
    const stagedFile = stagedFiles.get(target.absolutePath)
    if (stagedFile) {
      if (stagedFile.content === null) {
        throw new Error(
          `Failed to read file for ${operation} ${target.relativePath}: file is deleted by this patch`,
        )
      }
      return stagedFile.content
    }

    return fs.readFile(target.absolutePath, 'utf8').catch((error: unknown) => {
      throw new Error(
        `Failed to read file for ${operation} ${target.relativePath}: ${(error as Error).message}`,
      )
    })
  }

  for (const hunk of parsedPatch.hunks) {
    if (hunk.type === 'add') {
      const target = resolveTargetPath(hunk.path)
      const nextContent =
        hunk.contents.length === 0 || hunk.contents.endsWith('\n')
          ? hunk.contents
          : `${hunk.contents}\n`
      stagedFiles.set(target.absolutePath, { content: nextContent, target })
      changes.push({
        absolutePath: target.absolutePath,
        newContent: nextContent,
        oldContent: null,
        relativePath: target.relativePath,
        type: 'add',
      })
      continue
    }

    if (hunk.type === 'delete') {
      const target = resolveTargetPath(hunk.path)
      const existingContent = await readRequiredContent(target, 'deletion')
      stagedFiles.set(target.absolutePath, { content: null, target })
      changes.push({
        absolutePath: target.absolutePath,
        newContent: '',
        oldContent: existingContent,
        relativePath: target.relativePath,
        type: 'delete',
      })
      continue
    }

    const sourceTarget = resolveTargetPath(hunk.path)
    const nextTarget = hunk.movePath ? resolveTargetPath(hunk.movePath) : undefined
    const existingContent = await readRequiredContent(sourceTarget, 'update')
    const updateChunkStartLines: number[] = []
    const nextContent = applyUpdateChunks(
      sourceTarget.relativePath,
      existingContent,
      hunk.chunks,
      {
        onChunkResolved: ({ chunkIndex, startLineNumber }) => {
          updateChunkStartLines[chunkIndex] = startLineNumber
        },
      },
    )
    const writeTarget = nextTarget ?? sourceTarget

    if (!nextTarget && nextContent === normalizeContentLineEndings(existingContent)) {
      throw new Error(`Patch did not change ${sourceTarget.relativePath}`)
    }

    stagedFiles.set(writeTarget.absolutePath, { content: nextContent, target: writeTarget })
    if (nextTarget && nextTarget.absolutePath !== sourceTarget.absolutePath) {
      stagedFiles.set(sourceTarget.absolutePath, { content: null, target: sourceTarget })
    }

    changes.push({
      absolutePath: sourceTarget.absolutePath,
      newContent: nextContent,
      ...(nextTarget ? { nextAbsolutePath: nextTarget.absolutePath } : {}),
      oldContent: existingContent,
      relativePath: writeTarget.relativePath,
      type: 'update',
      updateChunkStartLines,
    })
  }

  for (const change of changes) {
    await options?.onBeforeChange?.({
      absolutePath: change.absolutePath,
      ...(change.nextAbsolutePath ? { nextAbsolutePath: change.nextAbsolutePath } : {}),
    })
  }

  await commitStagedFiles(stagedFiles)

  return { changes, parsedPatch }
  })
}

async function readFileSnapshot(absolutePath: string): Promise<FileSnapshot> {
  try {
    return {
      absolutePath,
      content: await fs.readFile(absolutePath, 'utf8'),
      existed: true,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { absolutePath, content: null, existed: false }
    }
    throw error
  }
}

async function restoreFileSnapshot(snapshot: FileSnapshot) {
  if (!snapshot.existed) {
    await retryTransientFilesystemOperation(() => fs.rm(snapshot.absolutePath, { force: true }))
    return
  }

  if (snapshot.content === null) {
    throw new Error(`Cannot restore an empty snapshot for ${snapshot.absolutePath}.`)
  }

  await writeTextFileAtomically(snapshot.absolutePath, snapshot.content)
}

async function commitStagedFiles(stagedFiles: Map<string, StagedFileState>) {
  const snapshots = await Promise.all(
    [...stagedFiles.keys()].map((absolutePath) => readFileSnapshot(absolutePath)),
  )
  const snapshotsByPath = new Map(snapshots.map((snapshot) => [snapshot.absolutePath, snapshot]))
  const committedSnapshots: FileSnapshot[] = []

  try {
    for (const stagedFile of stagedFiles.values()) {
      if (stagedFile.content === null) {
        await retryTransientFilesystemOperation(() => fs.rm(stagedFile.target.absolutePath, { force: false }))
      } else {
        await writeTextFileAtomically(stagedFile.target.absolutePath, stagedFile.content)
      }

      const snapshot = snapshotsByPath.get(stagedFile.target.absolutePath)
      if (snapshot) committedSnapshots.push(snapshot)
    }
  } catch (error) {
    let rollbackError: unknown
    for (const snapshot of committedSnapshots.reverse()) {
      try {
        await restoreFileSnapshot(snapshot)
      } catch (restoreError) {
        rollbackError ??= restoreError
      }
    }

    if (rollbackError !== undefined) {
      const originalMessage = error instanceof Error ? error.message : String(error)
      const restoreMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
      throw new Error(`${originalMessage}; rollback also failed: ${restoreMessage}`)
    }
    throw error
  }
}
