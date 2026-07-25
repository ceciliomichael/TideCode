export type KanbanErrorAction =
  | 'clear'
  | 'create'
  | 'delete'
  | 'load'
  | 'move'
  | 'plan'
  | 'refresh'
  | 'reorder'
  | 'save'

export interface KanbanUserFacingError {
  description: string
  guidance?: string
  relatedCardId?: string
  title: string
}

function readErrorMessage(error: unknown) {
  return error instanceof Error ? error.message.toLocaleLowerCase() : ''
}

const GENERIC_ERROR_COPY: Record<
  KanbanErrorAction,
  Pick<KanbanUserFacingError, 'description' | 'guidance' | 'title'>
> = {
  clear: {
    description: 'The completed tasks are still on the board.',
    guidance: 'Try clearing them again in a moment.',
    title: 'Completed tasks weren’t cleared',
  },
  create: {
    description: 'Your task wasn’t added to the board.',
    guidance: 'Check the task title and try again.',
    title: 'Task wasn’t created',
  },
  delete: {
    description: 'The task is still on the board.',
    guidance: 'Try deleting it again in a moment.',
    title: 'Task wasn’t deleted',
  },
  load: {
    description: 'The board could not be opened right now.',
    guidance: 'Make sure the project is still available, then try again.',
    title: 'Board couldn’t be opened',
  },
  move: {
    description: 'The task stayed in its current column.',
    guidance: 'Review the task requirements and try again.',
    title: 'Task couldn’t be moved',
  },
  plan: {
    description: 'AI could not prepare this task right now.',
    guidance: 'Check the planning model in Settings, then try again.',
    title: 'Task planning didn’t finish',
  },
  refresh: {
    description: 'The latest board changes could not be loaded.',
    guidance: 'Try again in a moment.',
    title: 'Board couldn’t be refreshed',
  },
  reorder: {
    description: 'The task stayed in its current position.',
    guidance: 'Review the task requirements and try again.',
    title: 'Task couldn’t be moved',
  },
  save: {
    description: 'Your latest task edits have not been saved yet.',
    guidance: 'Keep this task open and try editing it again.',
    title: 'Changes weren’t saved',
  },
}

export function presentKanbanError(
  action: KanbanErrorAction,
  error: unknown,
  relatedCardId?: string,
): KanbanUserFacingError {
  const message = readErrorMessage(error)

  if (message.includes('until all subtasks are done')) {
    return {
      description:
        'This task can move to Done after every subtask is marked Done.',
      guidance:
        'Review the task and finish or move each remaining subtask to Done.',
      relatedCardId,
      title: 'Finish the subtasks first',
    }
  }

  if (message.includes('until all acceptance criteria are complete')) {
    return {
      description:
        'This task can move to Done after every acceptance criterion is checked.',
      guidance: 'Review the task and complete the remaining criteria.',
      relatedCardId,
      title: 'Complete the acceptance criteria first',
    }
  }

  if (
    message.includes('task not found') ||
    message.includes('not found after')
  ) {
    return {
      description:
        'This task may have been removed or changed in another window.',
      guidance: 'Close this message and refresh the board before continuing.',
      title: 'Task is no longer available',
    }
  }

  if (
    message.includes('task title is required') ||
    message.includes('task title cannot be blank')
  ) {
    return {
      description: 'Every task needs a short title before it can be saved.',
      guidance: 'Add a title and continue editing.',
      relatedCardId,
      title: 'Add a task title',
    }
  }

  if (
    message.includes('workspace path is required') ||
    message.includes('project')
  ) {
    return {
      description: 'The board needs an open project to store its tasks.',
      guidance: 'Open a project and try again.',
      title: 'Open a project first',
    }
  }

  if (
    message.includes('planning is turned off') ||
    message.includes('planning model')
  ) {
    return {
      description: 'AI task planning is not ready for this project.',
      guidance: 'Turn it on and choose a planning model in Settings.',
      title: 'Set up AI task planning',
    }
  }

  return {
    ...GENERIC_ERROR_COPY[action],
    relatedCardId,
  }
}
