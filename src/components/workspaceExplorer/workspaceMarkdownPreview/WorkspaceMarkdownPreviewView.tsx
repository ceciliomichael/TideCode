import React, { memo, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSlug from 'rehype-slug'
import remarkBreaks from 'remark-breaks'
import remarkEmoji from 'remark-emoji'
import remarkGfm from 'remark-gfm'
import { handleMarkdownLinkClick, preprocessMarkdown } from '../../../lib/markdown'
import { MarkdownListItem, MarkdownOrderedList } from '../../markdown/MarkdownList'
import { CodeBlock } from '../../chat/CodeBlock'
import { MermaidDiagram } from './MermaidDiagram'
import { WorkspaceMarkdownImage } from './WorkspaceMarkdownImage'

interface WorkspaceMarkdownPreviewViewProps {
  content: string
  fileName: string
  relativePath?: string
  workspaceRootPath?: string | null
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

function isSummaryElement(child: React.ReactNode): boolean {
  if (!React.isValidElement(child)) return false
  if (child.type === 'summary') return true
  if (typeof child.type === 'string' && child.type.toLowerCase() === 'summary') return true
  if (child.props && (child.props as { node?: { tagName?: string } }).node?.tagName === 'summary') return true
  return false
}

export const WorkspaceMarkdownPreviewView = memo(function WorkspaceMarkdownPreviewView({
  content,
  fileName,
  relativePath,
  workspaceRootPath,
  isTruncated = false,
}: WorkspaceMarkdownPreviewViewProps) {
  const markdownComponents = useMemo(
    () => ({
      h1: (props: React.ComponentPropsWithoutRef<'h1'>) => (
        <h1 {...props} className="scroll-mt-6 mt-0 mb-4 text-[1.5rem] font-semibold leading-tight text-foreground" />
      ),
      h2: (props: React.ComponentPropsWithoutRef<'h2'>) => (
        <h2 {...props} className="scroll-mt-6 mt-5 mb-2 text-[1.18rem] font-semibold leading-tight text-foreground" />
      ),
      h3: (props: React.ComponentPropsWithoutRef<'h3'>) => (
        <h3 {...props} className="scroll-mt-6 mt-4 mb-2 text-[1.05rem] font-semibold leading-tight text-foreground" />
      ),
      h4: (props: React.ComponentPropsWithoutRef<'h4'>) => (
        <h4 {...props} className="scroll-mt-6 mt-3 mb-1.5 text-[0.98rem] font-semibold leading-tight text-foreground" />
      ),
      h5: (props: React.ComponentPropsWithoutRef<'h5'>) => (
        <h5 {...props} className="scroll-mt-6 mt-3 mb-1.5 text-[0.94rem] font-semibold leading-tight text-foreground" />
      ),
      h6: (props: React.ComponentPropsWithoutRef<'h6'>) => (
        <h6 {...props} className="scroll-mt-6 mt-3 mb-1.5 text-[0.84rem] font-semibold uppercase tracking-wide text-muted-foreground" />
      ),
      p: (props: React.ComponentPropsWithoutRef<'p'>) => (
        <p {...props} className="my-0 mb-3 leading-[1.65] text-foreground last:mb-0" />
      ),
      ul: (props: React.ComponentPropsWithoutRef<'ul'>) => (
        <ul {...props} className="my-3 list-disc space-y-1 pl-6 text-foreground last:mb-0" />
      ),
      ol: (props: React.ComponentPropsWithoutRef<'ol'>) => (
        <MarkdownOrderedList {...props} className="my-3 space-y-1 text-foreground last:mb-0" />
      ),
      li: (props: React.ComponentPropsWithoutRef<'li'>) => (
        <MarkdownListItem {...props} className="text-foreground" />
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

          return (
            <CodeBlock
              code={codeText}
              headerLabel={language ?? ''}
              language={language}
              fileName={undefined}
              showHeaderTooltip={false}
            />
          )
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
        const foundSummary = childArray.find(isSummaryElement)
        const contentChildren = childArray.filter((child) => child !== foundSummary)

        // Clean up leading and trailing whitespace from raw text children to prevent empty blank lines
        if (contentChildren.length > 0 && typeof contentChildren[0] === 'string') {
          contentChildren[0] = (contentChildren[0] as string).replace(/^\s+/, '')
        }
        if (contentChildren.length > 0 && typeof contentChildren[contentChildren.length - 1] === 'string') {
          contentChildren[contentChildren.length - 1] = (contentChildren[contentChildren.length - 1] as string).replace(/\s+$/, '')
        }

        const summaryChild = foundSummary || (
          <summary className="flex cursor-pointer select-none items-center justify-between px-3.5 py-2.5 font-medium text-foreground hover:bg-surface-muted/50 transition-colors focus:outline-none list-none [&::-webkit-details-marker]:hidden after:content-['›'] after:ml-auto after:text-lg after:font-semibold after:text-foreground/70 after:transition-transform after:duration-200 group-open/details:after:rotate-90">
            Details
          </summary>
        )

        return (
          <details
            {...props}
            className="group/details my-3 w-full overflow-hidden rounded-xl border border-border bg-surface-muted/30 text-foreground transition-all"
          >
            {summaryChild}
            {contentChildren.length > 0 ? (
              <div className="p-3.5 pt-1 space-y-3 text-foreground whitespace-pre-wrap [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
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
                ? 'mt-6 border-t border-border/60 pt-3 text-xs text-muted-foreground [&>ol]:pl-0 [&>ol]:space-y-1.5 [&_a]:text-primary [&_a]:underline'
                : 'my-3 border-t border-border pt-2 text-xs text-muted-foreground',
            ]
              .filter(Boolean)
              .join(' ')}
          />
        )
      },
      a: ({ href, children, ...props }: React.ComponentPropsWithoutRef<'a'>) => (
        <a
          {...props}
          href={href}
          onClick={(e) => handleMarkdownLinkClick(e, href, relativePath)}
          className="text-foreground underline decoration-border underline-offset-2 transition-colors hover:decoration-foreground cursor-pointer [&_code]:mx-0 [&_code]:text-inherit [&_code]:decoration-inherit"
        >
          {children}
        </a>
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
      img: ({ src, alt }: React.ComponentPropsWithoutRef<'img'>) => (
        <WorkspaceMarkdownImage
          alt={alt}
          currentRelativePath={relativePath}
          src={src}
          workspaceRootPath={workspaceRootPath}
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
              className="mr-2 inline-block align-middle accent-[var(--color-brand)]"
            />
          )
        }

        return <input {...props} />
      },
      hr: (props: React.ComponentPropsWithoutRef<'hr'>) => <hr {...props} className="my-5 border-border" />,
    }),
    [fileName, relativePath, workspaceRootPath],
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
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkEmoji, remarkBreaks]} rehypePlugins={[rehypeRaw, rehypeSlug]} components={markdownComponents}>
            {useMemo(() => preprocessMarkdown(content), [content])}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  )
})
