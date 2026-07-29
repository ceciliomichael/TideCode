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

    // Normalize details and summary block HTML tags onto separate lines if written inline
    if (processedLine.includes('<details>') || processedLine.includes('<summary>')) {
      processedLine = processedLine
        .replace(/<details>/g, '\n<details>\n')
        .replace(/<\/details>/g, '\n</details>\n')
        .replace(/<summary>/g, '\n<summary>')
        .replace(/<\/summary>/g, '</summary>\n')
    }

    // Process inline highlight: ==text== -> <mark>text</mark>
    processedLine = processedLine.replace(/==([^=]+)==/g, '<mark>$1</mark>')

    // Process superscript: ^text^ -> <sup>text</sup> (avoid matching GFM footnote refs like [^1])
    processedLine = processedLine.replace(/(?<!\[)\^([^\^\s\\]+)\^/g, '<sup>$1</sup>')

    // Process subscript: ~text~ (not ~~strikethrough~~) -> <sub>text</sub>
    processedLine = processedLine.replace(/(?<!~)~([^~\s]+)~(?!~)/g, '<sub>$1</sub>')

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


