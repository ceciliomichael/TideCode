import { Bot, CheckCircle2, ChevronRight, KeyRound, Server } from 'lucide-react'
import type { ApiKeyProviderStatus } from '../../../types/chat'

interface ProviderCardProps {
  description: string
  isCodex?: boolean
  label: string
  onClick: () => void
  status?: ApiKeyProviderStatus
  isConfigured?: boolean
}

export function ProviderCard({
  description,
  isCodex = false,
  label,
  onClick,
  status,
  isConfigured = status?.configured ?? false,
}: ProviderCardProps) {
  const Icon = isCodex ? Bot : status?.isCustom ? Server : KeyRound

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-20 w-full items-center gap-3 rounded-xl border border-border bg-surface p-4 text-left transition-[transform,border-color,background-color] hover:-translate-y-0.5 hover:bg-surface-muted active:translate-y-0 md:px-5"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-foreground">
        <Icon size={19} />
      </span>
      <span className="min-w-0 flex-1 md:flex md:items-center md:gap-6">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">{label}</span>
            {isConfigured ? <CheckCircle2 size={15} className="shrink-0 text-accent-foreground" /> : null}
          </span>
          <span className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground md:line-clamp-1">{description}</span>
        </span>
        <span className="mt-2 inline-flex shrink-0 items-center gap-1 text-xs font-medium text-foreground md:mt-0">
          {isConfigured ? 'Edit setup' : 'Configure'}
          <ChevronRight size={13} className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </span>
    </button>
  )
}
