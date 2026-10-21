import type { CSSProperties, ReactNode } from 'react'
import type { TideNode } from '../../lib/tideui/types'
import { getTideNodeStyle, hasTideCustomHover } from '../../lib/tideui/style'

export function TideUILayout({ node, children }: { node: TideNode; children: ReactNode }) {
  switch (node.kind) {
    case 'panel':
    case 'card':
      return <div className="tideui-card" data-tideui-hover={node.props.hover || undefined}
        data-tideui-custom-hover={hasTideCustomHover(node) ? 'true' : undefined}
        style={getTideNodeStyle(node)}
        tabIndex={node.props.hover && node.props.hover !== 'none' || hasTideCustomHover(node) ? 0 : undefined}>
        {node.args[0] ? <div className="tideui-heading">{node.args[0]}</div> : null}{children}
      </div>
    case 'section':
      return <section className="tideui-section" style={getTideNodeStyle(node)}>{node.args[0] ? <h4 className="tideui-heading">{node.args[0]}</h4> : null}{children}</section>
    case 'row':
      return <div className="tideui-row" style={getTideNodeStyle(node)}>{children}</div>
    case 'column':
      return <div className="tideui-column" style={getTideNodeStyle(node)}>{children}</div>
    case 'grid': {
      const columns = Math.max(1, Math.min(4, Number(node.args[0]) || Number(node.props.columns) || 2))
      return <div className="tideui-grid" style={{ ...getTideNodeStyle(node), '--tideui-columns': columns } as CSSProperties}>{children}</div>
    }
    case 'divider':
      return <hr className="tideui-divider" />
    default:
      return <>{children}</>
  }
}
