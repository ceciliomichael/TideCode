import { useMemo } from 'react'
import { CheckCircle2, Circle, ListChecks, Tag, FolderGit2, LayoutGrid, Trash2 } from 'lucide-react'
import type { ToolInvocationTrace } from '../../types/chat'
import { parseStructuredToolResultContent } from '../../lib/toolResultContent'
import { MarkdownRenderer } from './MarkdownRenderer'

interface KanbanToolResultProps {
  invocation: ToolInvocationTrace
  isStreaming?: boolean
}

interface AcceptanceCriterion {
  completed?: boolean
  id?: string
  text: string
}

interface KanbanCardData {
  acceptanceCriteria?: AcceptanceCriterion[]
  assignee?: string
  columnId?: string
  description?: string
  id?: string
  issueType?: string
  labels?: string[]
  parentCardId?: string
  priority?: string
  title?: string
}

function ColumnBadge({ columnId }: { columnId: string }) {
  const normalized = columnId.toLowerCase()
  let colorStyle = 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
  let label = columnId

  if (normalized === 'backlog') {
    colorStyle = 'bg-slate-500/15 text-slate-300 border-slate-500/30'
    label = 'Backlog'
  } else if (normalized === 'in-progress') {
    colorStyle = 'bg-brand/15 text-brand border-brand/30'
    label = 'In Progress'
  } else if (normalized === 'blocked') {
    colorStyle = 'bg-amber-500/15 text-amber-400 border-amber-500/30'
    label = 'Blocked'
  } else if (normalized === 'done') {
    colorStyle = 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
    label = 'Done'
  }

  return (
    <span className={`inline-flex items-center shrink-0 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase ${colorStyle}`}>
      {label}
    </span>
  )
}

function PriorityBadge({ priority }: { priority: string }) {
  const normalized = priority.toLowerCase()
  if (normalized === 'none') return null

  let colorStyle = 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
  if (normalized === 'high' || normalized === 'urgent') {
    colorStyle = 'bg-rose-500/15 text-rose-400 border-rose-500/30'
  } else if (normalized === 'medium') {
    colorStyle = 'bg-amber-500/15 text-amber-400 border-amber-500/30'
  } else if (normalized === 'low') {
    colorStyle = 'bg-slate-500/15 text-slate-400 border-slate-500/30'
  }

  return (
    <span className={`inline-flex items-center shrink-0 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10px] font-medium capitalize ${colorStyle}`}>
      {priority}
    </span>
  )
}

function IssueTypeBadge({ issueType }: { issueType: string }) {
  const normalized = issueType.toLowerCase()
  let colorStyle = 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'

  if (normalized === 'bug') {
    colorStyle = 'bg-red-500/10 text-red-400 border-red-500/20'
  } else if (normalized === 'idea') {
    colorStyle = 'bg-purple-500/10 text-purple-400 border-purple-500/20'
  }

  return (
    <span className={`inline-flex items-center shrink-0 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[10px] font-medium capitalize ${colorStyle}`}>
      {issueType}
    </span>
  )
}

function AcceptanceCriteriaList({ criteria }: { criteria: AcceptanceCriterion[] }) {
  if (!criteria || criteria.length === 0) return null

  const completedCount = criteria.filter((c) => c.completed).length

  return (
    <div className="mt-2 space-y-1.5 rounded-lg border border-border/40 bg-surface-muted/40 p-2.5">
      <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground">
        <span className="flex items-center gap-1">
          <ListChecks className="h-3.5 w-3.5 text-primary/80" />
          Acceptance Criteria
        </span>
        <span className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {completedCount}/{criteria.length} completed
        </span>
      </div>
      <div className="space-y-1 pt-0.5">
        {criteria.map((item, index) => (
          <div key={item.id || index} className="flex items-start gap-2 text-[12px] text-foreground/90">
            {item.completed ? (
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
            ) : (
              <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
            )}
            <span className={item.completed ? 'line-through opacity-70' : ''}>
              {item.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function CardItemView({ card, isSubtask = false }: { card: KanbanCardData; isSubtask?: boolean }) {
  if (!card || !card.title) return null

  return (
    <div className={`w-full space-y-2 rounded-xl border border-border/60 bg-surface/70 p-3.5 shadow-xs ${isSubtask ? 'border-l-2 border-l-primary/50 bg-surface/50' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-semibold leading-snug text-foreground">{card.title}</span>
        <div className="flex items-center gap-1.5">
          {card.columnId && <ColumnBadge columnId={card.columnId} />}
          {card.priority && card.priority !== 'none' && <PriorityBadge priority={card.priority} />}
          {card.issueType && <IssueTypeBadge issueType={card.issueType} />}
        </div>
      </div>

      {card.description ? (
        <p className="text-xs leading-relaxed text-muted-foreground/90 line-clamp-3">
          {card.description}
        </p>
      ) : null}

      {card.labels && card.labels.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1 pt-0.5">
          {card.labels.map((label) => (
            <span key={label} className="inline-flex items-center gap-0.5 rounded-md bg-secondary/60 px-1.5 py-0.5 text-[11px] text-secondary-foreground">
              <Tag className="h-2.5 w-2.5 opacity-70" />
              {label}
            </span>
          ))}
        </div>
      ) : null}

      {card.acceptanceCriteria && card.acceptanceCriteria.length > 0 ? (
        <AcceptanceCriteriaList criteria={card.acceptanceCriteria} />
      ) : null}
    </div>
  )
}

function getCleanSummary(summary: string | null, cardTitle?: string): string | null {
  if (!summary) return null
  const cleaned = summary
    .replace(
      /^(Read task|Read board|Fetched card|Moved task to [^:]+|Updated task|Created task|Created parent task|Reordered task):\s*/i,
      '',
    )
    .trim()
  if (!cleaned) return null
  if (cardTitle && cleaned.toLowerCase() === cardTitle.toLowerCase()) {
    return null
  }
  return cleaned
}

function getKanbanAction(invocation: ToolInvocationTrace): string {
  if (invocation.toolName !== 'kanban_board') {
    return invocation.toolName
  }
  try {
    const parsed = JSON.parse(invocation.argumentsText)
    if (parsed && typeof parsed.action === 'string') {
      return parsed.action
    }
  } catch {}
  return 'kanban_board'
}

function shouldRenderStyledCardUI(action: string): boolean {
  return (
    action === 'create_card' ||
    action === 'create_task_with_subtasks' ||
    action === 'update_card' ||
    action === 'read_card' ||
    action === 'read_board' ||
    action === 'move_card' ||
    action === 'reorder_card'
  )
}

function extractCardFromData(data: unknown): KanbanCardData | null {
  if (!data || typeof data !== 'object') return null
  const obj = data as Record<string, unknown>
  if (obj.card && typeof obj.card === 'object') {
    const innerCard = obj.card as Record<string, unknown>
    if (
      innerCard.card &&
      typeof innerCard.card === 'object' &&
      typeof (innerCard.card as Record<string, unknown>).title === 'string'
    ) {
      return innerCard.card as KanbanCardData
    }
    if (typeof innerCard.title === 'string') {
      return innerCard as KanbanCardData
    }
  }
  if (typeof obj.title === 'string') {
    return obj as KanbanCardData
  }
  return null
}

function formatCardAsPlainMarkdown(card: KanbanCardData): string {
  const parts: string[] = []

  if (card.title) {
    const statusStr = card.columnId ? ` (${card.columnId})` : ''
    parts.push(`**${card.title}**${statusStr}`)
  }

  if (card.description) {
    parts.push(card.description)
  }

  if (card.acceptanceCriteria && card.acceptanceCriteria.length > 0) {
    const criteriaLines = card.acceptanceCriteria.map(
      (item) => `- [${item.completed ? 'x' : ' '}] ${item.text}`,
    )
    parts.push(`**Acceptance Criteria:**\n${criteriaLines.join('\n')}`)
  }

  return parts.join('\n\n')
}

function formatBoardOverviewAsPlainMarkdown(data: Record<string, unknown>): string {
  const columns = data.columns as Array<{ title: string; count: number; tasks?: Array<{ title: string }> }> | undefined
  if (!columns || !Array.isArray(columns)) return ''

  const lines: string[] = []

  for (const col of columns) {
    const taskCountStr = `${col.count} task${col.count === 1 ? '' : 's'}`
    lines.push(`**${col.title}** (${taskCountStr})`)
    if (col.tasks && col.tasks.length > 0) {
      for (const t of col.tasks) {
        lines.push(`- ${t.title}`)
      }
    } else {
      lines.push('- *No tasks*')
    }
    lines.push('')
  }

  return lines.join('\n').trim()
}

export function KanbanToolResult({ invocation, isStreaming = false }: KanbanToolResultProps) {
  const parsedInfo = useMemo(() => {
    if (!invocation.resultContent) return null
    const structured = parseStructuredToolResultContent(invocation.resultContent)
    const rawBody = structured?.body ?? structured?.metadata?.summary ?? invocation.resultContent

    try {
      const data = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody
      return { data, rawBody, summary: structured?.metadata?.summary ?? null }
    } catch {
      return { data: null, rawBody, summary: structured?.metadata?.summary ?? null }
    }
  }, [invocation.resultContent])

  if (!parsedInfo) {
    return isStreaming ? (
      <div className="p-2 text-[12px] text-muted-foreground">Running kanban operation...</div>
    ) : null
  }

  const { data, rawBody, summary } = parsedInfo
  const action = getKanbanAction(invocation)
  const isStyledUIAllowed = shouldRenderStyledCardUI(action)

  // Shape A: Parent task with subtasks (only for create/update actions)
  if (isStyledUIAllowed && data && typeof data === 'object' && 'parent' in data && data.parent) {
    const parentCard = data.parent as KanbanCardData
    const subtasks = Array.isArray(data.subtasks) ? (data.subtasks as KanbanCardData[]) : []
    const displaySummary = getCleanSummary(summary, parentCard.title)

    return (
      <div className="space-y-3 rounded-xl border border-border bg-surface p-3.5 shadow-sm">
        {displaySummary ? (
          <div className="text-[12px] font-medium text-foreground/90">{displaySummary}</div>
        ) : null}

        <CardItemView card={parentCard} />

        {subtasks.length > 0 ? (
          <div className="space-y-2 pt-1">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <FolderGit2 className="h-3.5 w-3.5 text-primary/80" />
              <span>Subtasks ({subtasks.length})</span>
            </div>
            <div className="space-y-2">
              {subtasks.map((subtask, index) => (
                <CardItemView key={subtask.id || index} card={subtask} isSubtask />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  // Shape B: Single card (for create, update, and read_card actions)
  const extractedCard = isStyledUIAllowed ? extractCardFromData(data) : null
  if (isStyledUIAllowed && extractedCard) {
    const displaySummary = getCleanSummary(summary, extractedCard.title)

    return (
      <div className="space-y-2 rounded-xl border border-border bg-surface p-3.5 shadow-sm">
        {displaySummary ? (
          <div className="text-[12px] font-medium text-foreground/90">{displaySummary}</div>
        ) : null}
        <CardItemView card={extractedCard} />
      </div>
    )
  }

  // Shape C: Board Overview UI (100% consistent using CardItemView)
  if (data && typeof data === 'object' && 'columns' in data && Array.isArray((data as Record<string, unknown>).columns)) {
    const columns = (data as Record<string, unknown>).columns as Array<{
      id: string
      title: string
      count: number
      tasks?: KanbanCardData[]
    }>
    const totalCards =
      typeof (data as Record<string, unknown>).totalCards === 'number'
        ? ((data as Record<string, unknown>).totalCards as number)
        : columns.reduce((acc, c) => acc + c.count, 0)

    return (
      <div className="space-y-3 rounded-xl border border-border bg-surface p-3.5 shadow-sm">
        <div className="flex items-center justify-between border-b border-border/50 pb-2.5">
          <div className="flex items-center gap-2">
            <LayoutGrid className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-foreground">Board Overview</span>
          </div>
          <span className="rounded-md bg-secondary/80 px-2 py-0.5 font-mono text-[11px] font-medium text-secondary-foreground">
            {totalCards} {totalCards === 1 ? 'task' : 'tasks'}
          </span>
        </div>

        <div className="space-y-3">
          {columns.map((col) => {
            const taskList = col.tasks || []

            return (
              <div key={col.id} className="flex flex-col space-y-2 rounded-lg border border-border/60 bg-surface-muted/50 p-3">
                <div className="flex items-center justify-between border-b border-border/30 pb-2">
                  <div className="flex items-center gap-1.5">
                    <ColumnBadge columnId={col.id} />
                  </div>
                  <span className="font-mono text-[11px] font-semibold text-muted-foreground">
                    {col.count} {col.count === 1 ? 'task' : 'tasks'}
                  </span>
                </div>

                {taskList.length > 0 ? (
                  <div className="space-y-2 pt-1">
                    {taskList.map((task, idx) => (
                      <CardItemView key={task.id || idx} card={task} />
                    ))}
                  </div>
                ) : (
                  <div className="py-1 text-[11px] italic text-muted-foreground/60">
                    No tasks in this column.
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // Shape D: Specific Column Read UI (for read_board with columnId)
  if (data && typeof data === 'object' && 'cards' in data && Array.isArray((data as Record<string, unknown>).cards)) {
    const cards = (data as Record<string, unknown>).cards as KanbanCardData[]
    const columnInfo = (data as Record<string, unknown>).column as { id?: string; title?: string; count?: number } | undefined
    const colId = columnInfo?.id || (cards[0]?.columnId ?? 'backlog')

    return (
      <div className="space-y-3 rounded-xl border border-border bg-surface p-3.5 shadow-sm">
        <div className="flex items-center justify-between border-b border-border/50 pb-2.5">
          <div className="flex items-center gap-2">
            <ColumnBadge columnId={colId} />
          </div>
          <span className="rounded-md bg-secondary/80 px-2 py-0.5 font-mono text-[11px] font-medium text-secondary-foreground">
            {cards.length} {cards.length === 1 ? 'task' : 'tasks'}
          </span>
        </div>

        {cards.length === 0 ? (
          <div className="p-3 text-center text-xs italic text-muted-foreground/60">
            No tasks in this column.
          </div>
        ) : (
          <div className="space-y-2">
            {cards.map((card, index) => (
              <CardItemView key={card.id || index} card={card} />
            ))}
          </div>
        )}
      </div>
    )
  }

  // Shape E: Deleted Task UI (for delete_card)
  if (data && typeof data === 'object' && 'deletedCard' in data && (data as Record<string, unknown>).deletedCard) {
    const deletedCard = (data as Record<string, unknown>).deletedCard as KanbanCardData
    return (
      <div className="space-y-2 rounded-xl border border-rose-500/30 bg-rose-500/5 p-3.5 shadow-sm">
        <div className="flex items-center justify-between border-b border-rose-500/20 pb-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-rose-400">
            <Trash2 className="h-4 w-4" />
            <span>Deleted Task</span>
          </div>
          {deletedCard.columnId ? <ColumnBadge columnId={deletedCard.columnId} /> : null}
        </div>
        <CardItemView card={deletedCard} />
      </div>
    )
  }

  // Fallback for plain text, read_card, read_board, move_card, or errors — format as plain markdown text
  let textToShow = ''

  const plainCard = extractCardFromData(data)
  if (plainCard) {
    textToShow = formatCardAsPlainMarkdown(plainCard)
  } else if (data && typeof data === 'object' && 'columns' in data && Array.isArray((data as Record<string, unknown>).columns)) {
    textToShow = formatBoardOverviewAsPlainMarkdown(data as Record<string, unknown>)
  } else {
    const rawSummary = summary && summary.trim().length > 0 ? summary : null
    const cleanedSummary = rawSummary ? rawSummary.replace(/^(Read task|Read board):\s*/i, '').trim() : null
    textToShow = cleanedSummary || (typeof rawBody === 'string' ? rawBody : (data ? JSON.stringify(data, null, 2) : ''))
  }

  if (!textToShow || textToShow.trim().length === 0) {
    return null
  }

  return (
    <MarkdownRenderer
      content={textToShow}
      className="w-full opacity-85"
      isStreaming={isStreaming}
    />
  )
}
