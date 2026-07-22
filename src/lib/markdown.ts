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

    // Ensure there's a blank line before a table starts
    if (i > 0 && line.trim().startsWith('|') && line.includes('|') && !inCodeBlock) {
      const prevLine = lines[i - 1].trim()
      if (prevLine.length > 0 && !prevLine.startsWith('|')) {
        // Insert a blank line before this table row
        lines.splice(i, 0, '')
        i++ // adjust for the inserted line
      }
    }
  }

  return lines.join('\n')
}
