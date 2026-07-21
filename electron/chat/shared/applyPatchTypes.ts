export type ApplyPatchHunk =
  | {
      contents: string
      path: string
      type: 'add'
    }
  | {
      path: string
      type: 'delete'
    }
  | {
      chunks: ApplyPatchUpdateChunk[]
      movePath?: string
      path: string
      type: 'update'
    }

export interface ApplyPatchUpdateChunk {
  changeContext?: string
  contextLineMappings: Array<{
    newLineIndex: number
    oldLineIndex: number
  }>
  offset?: {
    startLine: number
    lineCount: number
  }
  isEndOfFile?: boolean
  newLines: string[]
  oldLines: string[]
}

export interface ApplyPatchChange {
  absolutePath: string
  nextAbsolutePath?: string
  newContent: string
  oldContent: string | null
  relativePath: string
  type: 'add' | 'delete' | 'update'
}

export interface ParsedApplyPatch {
  hunks: ApplyPatchHunk[]
}

export interface ApplyPatchTargetPath {
  absolutePath: string
  relativePath: string
}

export interface ApplyPatchWorkspaceOptions {
  basePath?: string
  onBeforeChange?: (input: {
    absolutePath: string
    nextAbsolutePath?: string
  }) => Promise<void> | void
  resolveTargetPath?: (candidatePath: string) => ApplyPatchTargetPath
}
