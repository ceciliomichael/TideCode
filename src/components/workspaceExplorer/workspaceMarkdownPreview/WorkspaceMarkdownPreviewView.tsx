import { memo, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { preprocessMarkdown } from '../../../lib/markdown'
import { CodeBlock } from '../../chat/CodeBlock'
import { MermaidDiagram } from './MermaidDiagram'

interface WorkspaceMarkdownPreviewViewProps {
  content: string
  fileName: string
  isTruncated?: boolean
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

function extractLanguage(className: string | undefined) {
  if (!className) {
    return undefined
  }

  const match = className.match(/language-([^\s]+)/)
  return match?.[1]
}

function isBlockCode(nodeClassName: string | undefined, inline: boolean | undefined, codeText: string) {
  return inline === false || (typeof nodeClassName === 'string' && nodeClassName.includes('language-')) || codeText.includes('\n')
}

export const WorkspaceMarkdownPreviewView = memo(function WorkspaceMarkdownPreviewView({
  content,
  fileName,
  isTruncated = false,
}: WorkspaceMarkdownPreviewViewProps) {
  const markdownComponents = useMemo(
    () => ({
      h1: (props: React.ComponentPropsWithoutRef<'h1'>) => (
        <h1 {...props} className="mt-0 mb-4 text-[1.5rem] font-semibold leading-tight text-foreground" />
      ),
      h2: (props: React.ComponentPropsWithoutRef<'h2'>) => (
        <h2 {...props} className="mt-5 mb-2 text-[1.18rem] font-semibold leading-tight text-foreground" />
      ),
      h3: (props: React.ComponentPropsWithoutRef<'h3'>) => (
        <h3 {...props} className="mt-4 mb-2 text-[1.05rem] font-semibold leading-tight text-foreground" />
      ),
      h4: (props: React.ComponentPropsWithoutRef<'h4'>) => (
        <h4 {...props} className="mt-3 mb-1.5 text-[0.98rem] font-semibold leading-tight text-foreground" />
      ),
      h5: (props: React.ComponentPropsWithoutRef<'h5'>) => (
        <h5 {...props} className="mt-3 mb-1.5 text-[0.94rem] font-semibold leading-tight text-foreground" />
      ),
      h6: (props: React.ComponentPropsWithoutRef<'h6'>) => (
        <h6 {...props} className="mt-3 mb-1.5 text-[0.84rem] font-semibold uppercase tracking-wide text-muted-foreground" />
      ),
      p: (props: React.ComponentPropsWithoutRef<'p'>) => (
        <p {...props} className="my-0 mb-3 leading-6 text-foreground last:mb-0" />
      ),
      ul: (props: React.ComponentPropsWithoutRef<'ul'>) => (
        <ul {...props} className="my-3 list-disc space-y-1 pl-6 text-foreground last:mb-0" />
      ),
      ol: (props: React.ComponentPropsWithoutRef<'ol'>) => (
        <ol {...props} className="my-3 list-decimal space-y-1 pl-6 text-foreground last:mb-0" />
      ),
      li: (props: React.ComponentPropsWithoutRef<'li'>) => (
        <li {...props} className="my-0 leading-6 text-foreground [&>p]:my-0 [&>p]:mb-0 [&>p+p]:mt-1" />
      ),
      blockquote: (props: React.ComponentPropsWithoutRef<'blockquote'>) => (
        <blockquote
          {...props}
          className="my-4 rounded-xl border border-border bg-surface-muted px-4 py-3 text-foreground/90"
        />
      ),
      pre: ({ children }: React.ComponentPropsWithoutRef<'pre'>) => <>{children}</>,
      code: ({ children, className: nodeClassName, inline, ...props }: CodeNodeProps) => {
        const codeText = extractCodeText(children)
        const language = extractLanguage(nodeClassName)

        if (isBlockCode(nodeClassName, inline, codeText)) {
          if (language === 'mermaid') {
            return <MermaidDiagram code={codeText} />
          }

          return <CodeBlock code={codeText} language={language} fileName={fileName} />
        }

        return (
          <code {...props} className="rounded bg-surface-muted px-1.5 py-0.5 text-[13px] text-foreground">
            {children}
          </code>
        )
      },
      a: (props: React.ComponentPropsWithoutRef<'a'>) => (
        <a
          {...props}
          target="_blank"
          rel="noreferrer"
          className="text-foreground underline decoration-border underline-offset-2 transition-colors hover:decoration-foreground"
        />
      ),
      table: (props: React.ComponentPropsWithoutRef<'table'>) => (
        <div className="my-4 overflow-x-auto rounded-2xl border border-border bg-surface shadow-sm">
          <table {...props} className="w-full border-collapse text-left text-[14px]" />
        </div>
      ),
      thead: (props: React.ComponentPropsWithoutRef<'thead'>) => (
        <thead {...props} className="bg-surface-muted text-foreground" />
      ),
      tr: (props: React.ComponentPropsWithoutRef<'tr'>) => (
        <tr {...props} className="border-b border-border last:border-0" />
      ),
      th: (props: React.ComponentPropsWithoutRef<'th'>) => (
        <th {...props} className="px-3 py-2 text-left text-[13px] font-semibold text-foreground" />
      ),
      td: (props: React.ComponentPropsWithoutRef<'td'>) => (
        <td {...props} className="px-3 py-2 align-top text-left text-foreground" />
      ),
      img: (props: React.ComponentPropsWithoutRef<'img'>) => (
        <img
          {...props}
          loading="lazy"
          decoding="async"
          className="my-4 block max-w-full rounded-2xl border border-border bg-surface object-contain"
        />
      ),
      input: ({ ...props }: React.ComponentPropsWithoutRef<'input'>) => {
        if (props.type === 'checkbox') {
          return (
            <input
              {...props}
              type="checkbox"
              disabled
              readOnly
              className="mr-2 inline-block align-middle accent-[#8771FF]"
            />
          )
        }

        return <input {...props} />
      },
      hr: (props: React.ComponentPropsWithoutRef<'hr'>) => <hr {...props} className="my-5 border-border" />,
    }),
    [fileName],
  )

  return (
    <div className="workspace-markdown-preview h-full min-h-0 overflow-auto bg-background text-foreground">
      <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-4 py-3 md:px-6 md:py-4">
        {isTruncated ? (
          <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            This document is truncated. Save the file outside the workspace limit to see the full document.
          </div>
        ) : null}
        <div className="min-w-0">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {useMemo(() => preprocessMarkdown(content), [content])}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  )
})
