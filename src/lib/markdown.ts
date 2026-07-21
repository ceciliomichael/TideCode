export function preprocessMarkdown(markdown: string): string {
  const lines = markdown.split('\n')
  let inCodeBlock = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock
      continue
    }

    if (inCodeBlock) continue

    if (line.trim().startsWith('|') && line.includes('`')) {
      lines[i] = line.replace(/(?<!`)`([^`]+)`(?!`)/g, (_, code) => {
        return '`' + code.replace(/\|/g, '\\|') + '`'
      })
    }
  }

  return lines.join('\n')
}
