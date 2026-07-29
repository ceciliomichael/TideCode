import type { TextareaHTMLAttributes } from 'react'

interface LineNumberedTextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className' | 'onChange' | 'value'> {
  description?: string
  label: string
  onChange: (value: string) => void
  showLineNumbers?: boolean
  value: string
}

function getLineCount(value: string) {
  return Math.max(1, value.split(/\r?\n/).length)
}

export function LineNumberedTextarea({
  description,
  disabled,
  id,
  label,
  onChange,
  placeholder,
  rows = 4,
  showLineNumbers = true,
  value,
  ...rest
}: LineNumberedTextareaProps) {
  const lineCount = getLineCount(value)
  const gutterWidthCh = 3

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>

      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
        <div className="flex min-w-0 items-stretch">
          {showLineNumbers ? (
            <div className="shrink-0 border-r border-border bg-surface px-2 py-2.5">
              <div
                aria-hidden="true"
                className="select-none font-mono text-[11px] leading-5 text-subtle-foreground"
                style={{ minWidth: `${gutterWidthCh}ch` }}
              >
                {Array.from({ length: lineCount }, (_, index) => (
                  <div key={`${id ?? label}-line-${index + 1}`} className="text-right">
                    {index + 1}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <textarea
            {...rest}
            id={id}
            rows={rows}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            wrap="soft"
            spellCheck={false}
            className="min-h-28 min-w-0 flex-1 resize-none bg-surface px-3 py-2.5 font-mono text-[13px] leading-5 text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {description ? <p className="text-xs leading-5 text-muted-foreground">{description}</p> : null}
    </div>
  )
}
