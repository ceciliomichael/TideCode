import { Loader2, RefreshCw } from 'lucide-react'

interface SourceControlSyncButtonProps {
  disabled: boolean
  isSyncing: boolean
  onSync: () => Promise<void>
}

export function SourceControlSyncButton({
  disabled,
  isSyncing,
  onSync,
}: SourceControlSyncButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => void onSync()}
      className={[
        'inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg px-3 text-xs font-medium transition-colors',
        disabled ? 'chat-send-button-disabled cursor-not-allowed' : 'chat-send-button-enabled',
      ].join(' ')}
    >
      {isSyncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
      <span>{isSyncing ? 'Syncing Changes…' : 'Sync Changes'}</span>
    </button>
  )
}
