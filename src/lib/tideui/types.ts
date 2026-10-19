export interface TideNode {
  kind: string
  args: string[]
  props: Record<string, string>
  children: TideNode[]
  line: number
  text: string
}

export interface TideDocument {
  nodes: TideNode[]
  errors: string[]
  warnings: string[]
}

export interface TideInteraction {
  action: 'copy' | 'draft' | 'send' | 'open'
  value: string
}

export interface TideUIActions {
  onDraft?: (message: string) => boolean | void | Promise<boolean | void>
  onSend?: (message: string) => boolean | Promise<boolean>
  onCopy?: (value: string) => boolean | Promise<boolean>
  onOpen?: (url: string) => boolean | Promise<boolean>
}
