import type { CSSProperties, ReactNode } from 'react'
import type { TideNode } from '../../lib/tideui/types'

export function TideUILayout({ node, children }: { node: TideNode; children: ReactNode }) {
  switch (node.kind) {
    case 'panel':
    case 'card':
      return <div className="tideui-card" data-tideui-hover={node.props.hover || undefined}
        tabIndex={node.props.hover && node.props.hover !== 'none' ? 0 : undefined}>
        {node.args[0] ? <div className="tideui-heading">{node.args[0]}</div> : null}{children}
      </div>
    case 'section':
      return <section className="tideui-section">{node.args[0] ? <h4 className="tideui-heading">{node.args[0]}</h4> : null}{children}</section>
    case 'row':
      return <div className="tideui-row">{children}</div>
    case 'column':
      return <div className="tideui-column">{children}</div>
    case 'grid': {
      const columns = Math.max(1, Math.min(4, Number(node.args[0]) || Number(node.props.columns) || 2))
      return <div className="tideui-grid" style={{ '--tideui-columns': columns } as CSSProperties}>{children}</div>
    }
    case 'divider':
      return <hr className="tideui-divider" />
    default:
      return <>{children}</>
  }
}
