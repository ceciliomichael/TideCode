import type { TideNode } from '../../lib/tideui/types'

export function TideUIDiagrams({ node }: { node: TideNode }) {
  if (node.kind === 'timeline') {
    return <ol className="tideui-timeline">{node.children.filter(child => child.kind === 'event' || child.kind === 'row').map(event =>
      <li key={event.props.id || event.line}><strong>{event.args[0]}</strong>{event.args[1] ? <span>{event.args[1]}</span> : null}</li>,
    )}</ol>
  }
  if (node.kind === 'flow') {
    const nodes = node.children.filter(child => child.kind === 'node')
    const edges = node.children.filter(child => child.kind === 'edge')
    return <div className="tideui-flow">
      {nodes.map((item, index) => <div key={item.props.id || index} className="tideui-flow-node">
        <span>{item.args.join(' ')}</span>
        {index < nodes.length - 1 ? <span className="tideui-flow-arrow">
          <span aria-hidden="true">↓</span>
          {edges.find(edge => edge.props.from === item.props.id && edge.props.to === nodes[index + 1]?.props.id)?.args[0]}
        </span> : null}
      </div>)}
    </div>
  }
  return null
}
