import type { ToolInvocationTrace } from '../../types/chat'

type FileMutationActionKind = 'create' | 'delete' | 'overwrite' | 'verify'

function readSemanticsCount(value: unknown, key: string) {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const semanticsRecord = value as Record<string, unknown>
  const countValue = semanticsRecord[key]
  return typeof countValue === 'number' && Number.isFinite(countValue) ? countValue : null
}

export function detectFileMutationActionKind(
  invocation: ToolInvocationTrace,
  operation: string | null,
  semantics: Record<string, unknown> | null,
): FileMutationActionKind {
  const changeResultPresentation = invocation.resultPresentation?.kind === 'change_diff' ? invocation.resultPresentation : null
  if (changeResultPresentation && changeResultPresentation.changes.length === 1) {
    const [singleChange] = changeResultPresentation.changes
    if (singleChange.kind === 'add') {
      return 'create'
    }
    if (singleChange.kind === 'delete') {
      return 'delete'
    }
    return 'overwrite'
  }

  if (operation === 'noop') {
    return 'verify'
  }

  const addedPathCount = readSemanticsCount(semantics, 'added_path_count') ?? 0
  const deletedPathCount = readSemanticsCount(semantics, 'deleted_path_count') ?? 0
  const updatedPathCount = readSemanticsCount(semantics, 'updated_path_count') ?? 0
  const activeKindCount =
    Number(addedPathCount > 0) + Number(deletedPathCount > 0) + Number(updatedPathCount > 0)

  if (activeKindCount === 1) {
    if (addedPathCount > 0) {
      return 'create'
    }
    if (deletedPathCount > 0) {
      return 'delete'
    }
    if (updatedPathCount > 0) {
      return 'overwrite'
    }
  }

  return 'overwrite'
}

export function formatWriteVerb(actionKind: FileMutationActionKind, state: ToolInvocationTrace['state']) {
  if (state === 'running') {
    if (actionKind === 'create') {
      return 'Creating'
    }
    if (actionKind === 'overwrite') {
      return 'Editing'
    }
    if (actionKind === 'delete') {
      return 'Deleting'
    }
    if (actionKind === 'verify') {
      return 'Verifying'
    }
    return 'Editing'
  }

  if (state === 'failed') {
    if (actionKind === 'create') {
      return 'Create failed'
    }
    if (actionKind === 'overwrite') {
      return 'Edit failed'
    }
    if (actionKind === 'delete') {
      return 'Delete failed'
    }
    if (actionKind === 'verify') {
      return 'Verify failed'
    }
    return 'Edit failed'
  }

  if (actionKind === 'create') {
    return 'Created'
  }
  if (actionKind === 'overwrite') {
    return 'Edited'
  }
  if (actionKind === 'delete') {
    return 'Deleted'
  }
  if (actionKind === 'verify') {
    return 'Verified'
  }
  return 'Edited'
}

export function formatEditVerb(actionKind: 'create' | 'delete' | 'edit' | 'verify', state: ToolInvocationTrace['state']) {
  if (state === 'running') {
    if (actionKind === 'create') {
      return 'Creating'
    }
    if (actionKind === 'delete') {
      return 'Deleting'
    }
    if (actionKind === 'verify') {
      return 'Verifying'
    }
    return 'Editing'
  }

  if (state === 'failed') {
    if (actionKind === 'create') {
      return 'Create failed'
    }
    if (actionKind === 'delete') {
      return 'Delete failed'
    }
    if (actionKind === 'verify') {
      return 'Verify failed'
    }
    return 'Edit failed'
  }

  if (actionKind === 'create') {
    return 'Created'
  }
  if (actionKind === 'delete') {
    return 'Deleted'
  }
  if (actionKind === 'verify') {
    return 'Verified'
  }
  return 'Edited'
}
