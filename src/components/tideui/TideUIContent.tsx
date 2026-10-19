import { useState, type ReactNode } from 'react'
import { copyTextToClipboard } from '../../lib/clipboard'
import { isSafeTideUrl } from '../../lib/tideui/assetPolicy'
import { resolveTideTone } from '../../lib/tideui/tone'
import type { TideNode, TideUIActions } from '../../lib/tideui/types'
import { Tooltip } from '../Tooltip'

function TideUICode({ node, actions }: { node: TideNode; actions?: TideUIActions }) {
  const [copied, setCopied] = useState(false)
  const code = node.text || node.args.find(arg => arg !== 'copy' && arg !== node.props.lang) || ''
  const isCopyable = node.props.copy !== 'false'
  return <div className="tideui-code-container">
    {isCopyable ? <Tooltip content={copied ? 'Copied' : 'Copy code'} side="top" noWrap>
      <button type="button" className="tideui-code-copy"
        onClick={() => void Promise.resolve(actions?.onCopy ? actions.onCopy(code) : copyTextToClipboard(code)).then(result => setCopied(result))}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </Tooltip> : null}
    <pre className="tideui-code"><code>{code}</code></pre>
  </div>
}

export function TideUIContent({ node, children, actions }: { node: TideNode; children: ReactNode; actions?: TideUIActions }) {
  const content = node.text || node.args[0] || ''
  const tone = resolveTideTone(node.props.tone ?? node.args[1])
  switch (node.kind) {
    case 'item':
      return <div className="tideui-list-item">{node.text || node.args.join(' · ')}{children}</div>
    case 'heading':
      return <h3 className="tideui-title">{content}</h3>
    case 'text':
    case 'label':
    case 'caption':
      return <div className={node.kind === 'caption' ? 'tideui-caption' : 'tideui-text'}>{content}{children}</div>
    case 'metric':
      return <div className="tideui-metric" data-tideui-hover={node.props.hover || undefined}
        tabIndex={node.props.hover && node.props.hover !== 'none' ? 0 : undefined}>
        <div className="tideui-caption">{node.args[0]}</div>
        <strong>{node.args[1] || node.props.value || '0'}</strong>
      </div>
    case 'badge':
      return <span className={`tideui-badge tideui-status-${tone}`}>{content}</span>
    case 'alert':
      return <div className={`tideui-alert tideui-status-${tone}`} role="status">{content}{children}</div>
    case 'progress': {
      const value = Math.min(100, Math.max(0, Number((node.args[1] ?? node.props.value ?? '0').replace('%', '')) || 0))
      return <div className="tideui-progress"><div className="tideui-progress-label"><span>{content}</span><span>{value}%</span></div><div className="tideui-progress-track"><div style={{ width: `${value}%` }} /></div></div>
    }
    case 'code':
      return <TideUICode node={node} actions={actions} />
    case 'image': {
      const source = node.props.src || node.args[0] || ''
      return isSafeTideUrl(source) ? <img className="tideui-image" alt={node.props.alt || node.args[1] || ''} src={source} loading="lazy" referrerPolicy="no-referrer" /> : null
    }
    case 'gallery':
      return <div className="tideui-grid">{children}</div>
    default:
      return <>{children}</>
  }
}
