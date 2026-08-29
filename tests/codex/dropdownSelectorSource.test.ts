import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import test from 'node:test'

test('DropdownField uses the compact selector gap and Chat Mode styling for text variants', async () => {
  const source = await fs.readFile(
    new URL('../../src/components/ui/DropdownField.tsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /preferredPlacement: variant === 'text' \? 'above' : 'below'/u)
  assert.match(source, /className="space-y-0\.5"/u)
  assert.match(
    source,
    /flex w-full items-start justify-between gap-2 rounded-lg px-2\.5 py-2 text-left transition-\[background-color,color,box-shadow\]/u,
  )
  assert.match(source, /block min-w-0 flex-1 truncate text-\[15px\] leading-5/u)
})

test('ReasoningEffortBlock uses the text dropdown variant that inherits the Chat Mode selector design', async () => {
  const source = await fs.readFile(
    new URL('../../src/components/chat/ReasoningEffortBlock.tsx', import.meta.url),
    'utf8',
  )

  assert.match(source, /variant="text"/u)
  assert.match(source, /fitToContent=!\{fullWidth\}|fitToContent=\{!fullWidth\}/u)
  assert.match(source, /selectedOptionIconClassName="text-foreground"/u)
})
