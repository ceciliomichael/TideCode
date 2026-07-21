import { memo, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { preprocessMarkdown } from '../../lib/markdown'
import { CodeBlock } from './CodeBlock'

interface MarkdownRendererProps {
  content: string
  className?: string
  isStreaming?: boolean
  preserveLineBreaks?: boolean
}

interface CodeNodeProps extends React.ComponentPropsWithoutRef<'code'> {
  inline?: boolean
}

function extractCodeText(children: React.ReactNode): string {
  if (typeof children === 'string') {
    return children.replace(/\n$/, '')
  }

  if (Array.isArray(children)) {
    return children.map((child) => extractCodeText(child)).join('')
  }

  return String(children ?? '')
}

function extractLanguage(className: string | undefined): string | undefined {
  if (!className) {
    return undefined
  }

  const match = className.match(/language-([^\s]+)/)
  return match?.[1]
}

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  className,
  isStreaming = false,
  preserveLineBreaks = false,
}: MarkdownRendererProps) {
  const rootClassName = [
    'chat-markdown', 
    preserveLineBreaks ? 'whitespace-pre-wrap' : 'whitespace-normal', 
    className,
    '[&>*:first-child]:mt-0',
    '[&>*:last-child]:mb-0'
  ]
    .filter(Boolean)
    .join(' ')

  const markdownComponents = useMemo(
    () => ({
      h1: (props: React.ComponentPropsWithoutRef<'h1'>) => (
        <h1 {...props} className="mt-2 mb-2 text-[1.12rem] font-semibold leading-[1.3] text-foreground" />
      ),
      h2: (props: React.ComponentPropsWithoutRef<'h2'>) => (
        <h2 {...props} className="mt-2 mb-1.5 text-[1.05rem] font-semibold leading-[1.3] text-foreground" />
      ),
      h3: (props: React.ComponentPropsWithoutRef<'h3'>) => (
        <h3 {...props} className="mt-1.5 mb-1 text-[1rem] font-semibold leading-[1.3] text-foreground" />
      ),
      p: (props: React.ComponentPropsWithoutRef<'p'>) => (
        <p {...props} className="my-0 mb-3 leading-[1.52] text-foreground last:mb-0" />
      ),
      ul: (props: React.ComponentPropsWithoutRef<'ul'>) => (
        <ul {...props} className="my-2 list-disc pl-6 text-foreground last:mb-0" />
      ),
      ol: (props: React.ComponentPropsWithoutRef<'ol'>) => (
        <ol {...props} className="my-2 list-decimal pl-6 text-foreground last:mb-0" />
      ),
      li: (props: React.ComponentPropsWithoutRef<'li'>) => (
        <li {...props} className="my-0 leading-[1.45] [&>p]:my-0 [&>p]:mb-0 [&>p+p]:mt-1" />
      ),
      blockquote: (props: React.ComponentPropsWithoutRef<'blockquote'>) => (
        <blockquote {...props} className="my-2 border-l-2 border-border pl-3 italic text-muted-foreground" />
      ),
      pre: ({ children }: React.ComponentPropsWithoutRef<'pre'>) => <>{children}</>,
      code: ({ children, className: nodeClassName, inline, ...props }: CodeNodeProps) => {
        const codeText = extractCodeText(children)
        const isBlock =
          inline === false ||
          (typeof nodeClassName === 'string' && nodeClassName.includes('language-')) ||
          codeText.includes('\n')

        if (isBlock) {
          return <CodeBlock code={codeText} language={extractLanguage(nodeClassName)} isStreaming={isStreaming} />
        }

        return (
          <code {...props} className="rounded bg-surface-muted px-1 py-0.5 text-[13px]">
            {children}
          </code>
        )
      },
      a: (props: React.ComponentPropsWithoutRef<'a'>) => (
        <a
          {...props}
          target="_blank"
          rel="noreferrer"
          className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
        />
      ),
      table: (props: React.ComponentPropsWithoutRef<'table'>) => (
        <div className="my-2 overflow-x-auto rounded-xl border border-border">
          <table {...props} className="w-full border-collapse text-left text-[14px]" />
        </div>
      ),
      thead: (props: React.ComponentPropsWithoutRef<'thead'>) => <thead {...props} className="bg-surface-muted" />,
      tr: (props: React.ComponentPropsWithoutRef<'tr'>) => <tr {...props} className="border-b border-border last:border-0" />,
      th: (props: React.ComponentPropsWithoutRef<'th'>) => (
        <th {...props} className="px-3 py-2 text-left text-[13px] font-semibold text-foreground" />
      ),
      td: (props: React.ComponentPropsWithoutRef<'td'>) => (
        <td {...props} className="px-3 py-2 align-top text-left text-foreground" />
      ),
      hr: (props: React.ComponentPropsWithoutRef<'hr'>) => <hr {...props} className="my-2 border-border" />,
    }),
    [isStreaming],
  )

  const processedContent = useMemo(() => preprocessMarkdown(content), [content])

  return (
    <div className={rootClassName}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {processedContent}
      </ReactMarkdown>
    </div>
  )
})
