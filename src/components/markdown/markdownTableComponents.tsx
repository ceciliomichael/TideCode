import type { ComponentPropsWithoutRef } from 'react'

export const markdownTableComponents = {
  table: (props: ComponentPropsWithoutRef<'table'>) => (
    <div className="my-2 overflow-x-auto rounded-xl border border-border">
      <table {...props} className="w-full border-collapse text-left text-[14px]" />
    </div>
  ),
  thead: (props: ComponentPropsWithoutRef<'thead'>) => <thead {...props} className="bg-surface-muted" />,
  tr: (props: ComponentPropsWithoutRef<'tr'>) => <tr {...props} className="border-b border-border last:border-0" />,
  th: (props: ComponentPropsWithoutRef<'th'>) => <th {...props} className="px-3 py-2 text-left text-[13px] font-semibold text-foreground" />,
  td: (props: ComponentPropsWithoutRef<'td'>) => <td {...props} className="px-3 py-2 align-top text-left text-foreground" />,
}

