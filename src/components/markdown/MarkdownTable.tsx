import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { markdownTableComponents } from './markdownTableComponents'

/** Native TideUI tables contain escaped literal cells, with no code/editor path. */
export function MarkdownTable({ content }: { content: string }) {
  return <div className="chat-markdown text-left min-w-0 max-w-full overflow-hidden whitespace-normal">
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownTableComponents}>{content}</ReactMarkdown>
  </div>
}
