import { defaultSchema, type Options as RehypeSanitizeOptions } from 'rehype-sanitize'

const CHAT_MARKDOWN_EXTRA_TAG_NAMES = ['mark']
const CHAT_MARKDOWN_STRIPPED_TAG_NAMES = [
  'button',
  'embed',
  'form',
  'iframe',
  'input',
  'object',
  'style',
  'template',
  'textarea',
]

function appendUniqueValues(values: readonly string[], additions: readonly string[]) {
  return [...new Set([...values, ...additions])]
}

function removeValues(values: readonly string[], removals: readonly string[]) {
  const removalSet = new Set(removals)
  return values.filter((value) => !removalSet.has(value))
}

/**
 * Chat content can contain model-generated HTML while it is being streamed.
 * Keep the renderer's intentional formatting extensions, but never allow
 * model text to create styles, executable content, or interactive controls.
 */
export const chatMarkdownSanitizeSchema: RehypeSanitizeOptions = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    mark: [],
  },
  strip: appendUniqueValues(defaultSchema.strip ?? [], CHAT_MARKDOWN_STRIPPED_TAG_NAMES),
  tagNames: appendUniqueValues(
    removeValues(defaultSchema.tagNames ?? [], CHAT_MARKDOWN_STRIPPED_TAG_NAMES),
    CHAT_MARKDOWN_EXTRA_TAG_NAMES,
  ),
}
