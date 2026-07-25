export function preprocessMarkdown(markdown: string): string {
  if (!markdown) return ''

  const lines = markdown.split('\n')
  const resultLines: string[] = []
  let inCodeBlock = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmedLine = line.trimStart()

    if (trimmedLine.startsWith('```')) {
      const indent = line.slice(0, line.length - trimmedLine.length)
      const afterBackticks = trimmedLine.slice(3)
      const trimmedAfter = afterBackticks.trim()

      if (inCodeBlock) {
        if (trimmedAfter.length === 0) {
          inCodeBlock = false
          resultLines.push(line)
        } else {
          inCodeBlock = false
          resultLines.push(`${indent}\`\`\``)
          const remainingLine = `${indent}${trimmedAfter}`
          resultLines.push(remainingLine)
        }
        continue
      } else {
        const isMarkdownElement = /^(?:#{1,6}\s|#{1,6}$|[-*+]\s|\d+\.\s|>)/u.test(trimmedAfter)

        if (isMarkdownElement) {
          resultLines.push(`${indent}\`\`\``)
          inCodeBlock = true
          resultLines.push(`${indent}${trimmedAfter}`)
        } else {
          inCodeBlock = true
          resultLines.push(line)
        }
        continue
      }
    }

    if (inCodeBlock) {
      resultLines.push(line)
      continue
    }

    let processedLine = line
    if (processedLine.trim().startsWith('|') && processedLine.includes('`')) {
      processedLine = processedLine.replace(/(?<!`)`([^`]+)`(?!`)/g, (_, code) => {
        return '`' + code.replace(/\|/g, '\\|') + '`'
      })
    }

    if (resultLines.length > 0 && processedLine.trim().startsWith('|') && processedLine.includes('|')) {
      const prevLine = resultLines[resultLines.length - 1].trim()
      if (prevLine.length > 0 && !prevLine.startsWith('|')) {
        resultLines.push('')
      }
    }

    resultLines.push(processedLine)
  }

  if (inCodeBlock) {
    resultLines.push('```')
  }

  return resultLines.join('\n')
}

