interface SwitchProps {
  checked: boolean
  className?: string
  disabled?: boolean
  label?: string
  onChange: (checked: boolean) => void
}

export function Switch({ checked, className = '', disabled = false, label, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        'relative h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:outline-none',
        checked ? 'bg-brand' : 'bg-border',
        disabled ? 'cursor-not-allowed opacity-50' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span
        className={[
          'absolute left-0.5 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0',
        ].join(' ')}
      />
    </button>
  )
}
