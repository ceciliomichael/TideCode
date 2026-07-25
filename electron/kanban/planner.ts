import { NoOutputGeneratedError, type ModelMessage } from 'ai'
import type { ChatProviderId, ReasoningEffort } from '../../src/types/chat'
import type { KanbanTaskPlan, KanbanTaskPlanInput } from '../../src/lib/kanban'
import { getStoredSettings } from '../settings/store'

interface PlannerModelSelection {
  modelId: string
  providerId: ChatProviderId
  reasoningEffort: ReasoningEffort
}

class InvalidKanbanTaskPlanError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidKanbanTaskPlanError'
  }
}

function isRecoverablePlannerOutputError(error: unknown) {
  return (
    error instanceof InvalidKanbanTaskPlanError ||
    NoOutputGeneratedError.isInstance(error)
  )
}

const TASK_PLANNER_SYSTEM_PROMPT = [
  'You are a pragmatic software delivery planner.',
  'Turn the supplied task into a concise, implementation-ready plan.',
  'Stay grounded in the user-provided title and context.',
  'Return only valid JSON with this exact shape:',
  '{"description":"string","acceptanceCriteria":["string"],"subtasks":["string"],"labels":["string"]}.',
  'Create 3-8 concrete subtasks in execution order.',
  'Create 2-6 observable acceptance criteria.',
  'Do not add markdown, code fences, commentary, IDs, estimates, or assignees.',
].join(' ')

function normalizeStringArray(
  value: unknown,
  maximumCount: number,
  maximumLength: number,
) {
  if (!Array.isArray(value)) {
    return []
  }

  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => item.slice(0, maximumLength)),
    ),
  ].slice(0, maximumCount)
}

export function parseKanbanTaskPlanResponse(value: string): KanbanTaskPlan {
  const trimmedValue = value.trim()
  const jsonStart = trimmedValue.indexOf('{')
  const jsonEnd = trimmedValue.lastIndexOf('}')
  if (jsonStart < 0 || jsonEnd <= jsonStart) {
    throw new InvalidKanbanTaskPlanError(
      'The planning model did not return a valid task plan.',
    )
  }

  let parsed: Record<string, unknown>
  try {
    const decoded = JSON.parse(trimmedValue.slice(jsonStart, jsonEnd + 1))
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
      throw new Error('Expected a JSON object.')
    }
    parsed = decoded as Record<string, unknown>
  } catch {
    throw new InvalidKanbanTaskPlanError(
      'The planning model did not return a valid task plan.',
    )
  }

  const description =
    typeof parsed.description === 'string'
      ? parsed.description.trim().slice(0, 8_000)
      : ''
  const acceptanceCriteria = normalizeStringArray(
    parsed.acceptanceCriteria,
    12,
    280,
  )
  const subtasks = normalizeStringArray(parsed.subtasks, 12, 180)
  const labels = normalizeStringArray(parsed.labels, 8, 32)

  if (
    !description &&
    acceptanceCriteria.length === 0 &&
    subtasks.length === 0
  ) {
    throw new InvalidKanbanTaskPlanError(
      'The planning model returned an empty task plan.',
    )
  }

  return {
    acceptanceCriteria,
    description,
    labels,
    subtasks,
  }
}

export function buildFallbackKanbanTaskPlan(
  input: KanbanTaskPlanInput,
): KanbanTaskPlan {
  const title = input.title.trim().slice(0, 500)
  const description = input.description?.trim().slice(0, 8_000)

  return {
    acceptanceCriteria: [
      `"${title}" works through the intended user flow.`,
      'Failure states are visible, actionable, and recoverable.',
      'Relevant automated checks pass and the completed flow is verified.',
    ],
    description:
      description ||
      `Deliver "${title}" as a complete, reliable change with clear behavior, validation, and a documented outcome.`,
    labels: [],
    subtasks: [
      'Confirm the expected behavior, constraints, and edge cases',
      'Implement the core change',
      'Add input validation and recoverable error handling',
      'Add or update automated coverage',
      'Verify the complete workflow and document the result',
    ],
  }
}

async function resolvePlannerSelection(): Promise<PlannerModelSelection> {
  const settings = await getStoredSettings()
  if (!settings.kanbanAiPlanningEnabled) {
    throw new Error('AI task planning is turned off in Settings.')
  }

  const selections = [
    {
      modelId: settings.kanbanModelId,
      providerId: settings.kanbanModelProviderId,
    },
    {
      modelId: settings.planModelId,
      providerId: settings.planModelProviderId,
    },
    {
      modelId: settings.chatModelId,
      providerId: settings.chatModelProviderId,
    },
  ]
  const selection = selections.find(
    (candidate): candidate is { modelId: string; providerId: ChatProviderId } =>
      candidate.modelId.trim().length > 0 && candidate.providerId !== null,
  )

  if (!selection) {
    throw new Error(
      'Choose a task planning model in Settings before using AI planning.',
    )
  }

  return {
    modelId: selection.modelId.trim(),
    providerId: selection.providerId,
    reasoningEffort: settings.chatReasoningEffort,
  }
}

async function requestPlannerText(
  selection: PlannerModelSelection,
  messages: ModelMessage[],
) {
  const stream =
    selection.providerId === 'codex'
      ? await (await import('../chat/codex/client'))
          .createCodexClient()
          .chat.completions.create({
            messages,
            model: selection.modelId,
            reasoningEffort: selection.reasoningEffort,
            system: TASK_PLANNER_SYSTEM_PROMPT,
          })
      : await (async () => {
          const { readApiKeyChatProviderConfig } =
            await import('../chat/apiKey/config')
          const { createApiKeyChatClient } =
            await import('../chat/apiKey/client')
          const apiKeyProviderId = selection.providerId as Exclude<
            ChatProviderId,
            'codex'
          >
          const providerConfig =
            await readApiKeyChatProviderConfig(apiKeyProviderId)
          return createApiKeyChatClient(providerConfig).chat.completions.create(
            {
              messages,
              model: selection.modelId,
              reasoningEffort: selection.reasoningEffort,
              system: TASK_PLANNER_SYSTEM_PROMPT,
            },
          )
        })()

  return (await stream.text).trim()
}

export async function generateKanbanTaskPlan(
  input: KanbanTaskPlanInput,
): Promise<KanbanTaskPlan> {
  const title = input.title.trim()
  if (!title) {
    throw new Error('Add a task title before asking AI to plan it.')
  }

  const selection = await resolvePlannerSelection()
  const messages: ModelMessage[] = [
    {
      content: [
        `Task title: ${title.slice(0, 500)}`,
        '',
        'Existing context:',
        input.description?.trim().slice(0, 8_000) || '(none yet)',
      ].join('\n'),
      role: 'user',
    },
  ]

  let firstResponse = ''
  try {
    firstResponse = await requestPlannerText(selection, messages)
    return parseKanbanTaskPlanResponse(firstResponse)
  } catch (error) {
    if (!isRecoverablePlannerOutputError(error)) {
      throw error
    }
  }

  const correctionMessages: ModelMessage[] = [
    ...messages,
    {
      content: firstResponse.slice(0, 8_000) || '(empty response)',
      role: 'assistant',
    },
    {
      content: [
        'Your previous response was not a valid task plan.',
        'Return only one valid JSON object with the exact required shape.',
        'Do not include markdown, code fences, or commentary.',
      ].join(' '),
      role: 'user',
    },
  ]

  try {
    return parseKanbanTaskPlanResponse(
      await requestPlannerText(selection, correctionMessages),
    )
  } catch (error) {
    if (!isRecoverablePlannerOutputError(error)) {
      throw error
    }
    console.warn(
      'Kanban AI planning produced no usable output twice; using a local editable plan.',
    )
    return buildFallbackKanbanTaskPlan({
      ...input,
      title,
    })
  }
}
