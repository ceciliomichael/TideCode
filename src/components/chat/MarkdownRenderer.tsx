import React, { memo, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import remarkEmoji from 'remark-emoji'
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

function isSummaryElement(child: React.ReactNode): boolean {
  if (!React.isValidElement(child)) return false
  if (child.type === 'summary') return true
  if (typeof child.type === 'string' && child.type.toLowerCase() === 'summary') return true
  if (child.props && (child.props as { node?: { tagName?: string } }).node?.tagName === 'summary') return true
  return false
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
    '[&>ul+ul]:-mt-1',
    '[&>ol+ol]:-mt-1'
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
        <p {...props} className="my-0 mb-3 leading-[1.65] text-foreground" />
      ),
      ul: (props: React.ComponentPropsWithoutRef<'ul'>) => (
        <ul {...props} className="my-2 space-y-1 list-disc pl-6 text-foreground" />
      ),
      ol: (props: React.ComponentPropsWithoutRef<'ol'>) => (
        <ol {...props} className="my-2 space-y-1 list-decimal pl-6 text-foreground" />
      ),
      li: (props: React.ComponentPropsWithoutRef<'li'>) => (
        <li {...props} className="my-0 leading-[1.6] [&>p]:my-0 [&>p]:mb-0 [&>p+p]:mt-1" />
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
          <code {...props} className="mx-[2px] rounded-xs border border-border/40 bg-surface-muted/60 px-1 py-[1px] font-[inherit] text-inherit [font-weight:inherit] text-foreground align-baseline">
            {children}
          </code>
        )
      },
      kbd: (props: React.ComponentPropsWithoutRef<'kbd'>) => (
        <kbd {...props} className="mx-[2px] rounded-xs border border-border/40 bg-surface-muted/60 px-1 py-[1px] font-[inherit] text-inherit [font-weight:inherit] text-foreground align-baseline" />
      ),
      sub: (props: React.ComponentPropsWithoutRef<'sub'>) => (
        <sub {...props} className="text-[0.75em] leading-none text-foreground" />
      ),
      sup: ({ className: supClassName, ...props }: React.ComponentPropsWithoutRef<'sup'>) => {
        const isFootnoteRef = 'data-footnote-ref' in props || (typeof supClassName === 'string' && supClassName.includes('footnote'))
        return (
          <sup
            {...props}
            className={[
              supClassName,
              'text-[0.75em] leading-none text-foreground',
              isFootnoteRef ? 'ml-0.5 font-semibold text-primary underline-offset-2 hover:underline' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          />
        )
      },
      mark: (props: React.ComponentPropsWithoutRef<'mark'>) => (
        <mark {...props} className="mx-[2px] rounded-xs bg-amber-500/25 px-1 py-[1px] text-inherit font-[inherit]" />
      ),
      details: ({ children, ...props }: React.ComponentPropsWithoutRef<'details'>) => {
        const childArray = React.Children.toArray(children)
        const summaryChild = childArray.find(isSummaryElement)
        const contentChildren = childArray.filter((child) => child !== summaryChild)

        return (
          <details
            {...props}
            className="group/details my-3 w-full overflow-hidden rounded-xl border border-border bg-surface-muted/30 text-foreground transition-all"
          >
            {summaryChild}
            {contentChildren.length > 0 ? (
              <div className="p-3.5 pt-1 space-y-3 text-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                {contentChildren}
              </div>
            ) : null}
          </details>
        )
      },
      summary: (props: React.ComponentPropsWithoutRef<'summary'>) => (
        <summary {...props} className="flex cursor-pointer select-none items-center justify-between px-3.5 py-2.5 font-medium text-foreground hover:bg-surface-muted/50 transition-colors focus:outline-none list-none [&::-webkit-details-marker]:hidden after:content-['›'] after:ml-auto after:text-lg after:font-semibold after:text-foreground/70 after:transition-transform after:duration-200 group-open/details:after:rotate-90" />
      ),
      del: (props: React.ComponentPropsWithoutRef<'del'>) => (
        <del {...props} className="line-through text-muted-foreground" />
      ),
      ins: (props: React.ComponentPropsWithoutRef<'ins'>) => (
        <ins {...props} className="underline text-foreground decoration-emerald-500" />
      ),
      dl: (props: React.ComponentPropsWithoutRef<'dl'>) => (
        <dl {...props} className="my-2 space-y-1 text-foreground" />
      ),
      dt: (props: React.ComponentPropsWithoutRef<'dt'>) => (
        <dt {...props} className="mt-2 font-semibold text-foreground" />
      ),
      dd: (props: React.ComponentPropsWithoutRef<'dd'>) => (
        <dd {...props} className="mb-1 pl-4 text-foreground/90" />
      ),
      section: ({ className: sectionClassName, ...props }: React.ComponentPropsWithoutRef<'section'>) => {
        const isFootnoteSection =
          'data-footnotes' in props ||
          (typeof sectionClassName === 'string' && sectionClassName.includes('footnotes'))
        return (
          <section
            {...props}
            className={[
              sectionClassName,
              isFootnoteSection
                ? 'mt-6 border-t border-border/60 pt-3 text-xs text-muted-foreground [&>ol]:list-decimal [&>ol]:pl-5 [&>ol]:space-y-1.5 [&_a]:text-primary [&_a]:underline'
                : 'my-3 border-t border-border pt-2 text-xs text-muted-foreground',
            ]
              .filter(Boolean)
              .join(' ')}
          />
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
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkEmoji]} rehypePlugins={[rehypeRaw]} components={markdownComponents}>
        {processedContent}
      </ReactMarkdown>
    </div>
  )
})

