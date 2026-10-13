// No Lexical import: core reads and checks a stored value with this alone, so a project without rich text installs no Lexical.

/** One node of Lexical's serialized editor state: a `type`, and `children` where it holds any. */
export type RichTextNode = { type: string; children?: RichTextNode[]; text?: string; [key: string]: unknown }

/** What a `richText` field holds: Lexical's `editorState.toJSON()`, a root of `type: 'root'`. */
export type RichTextValue = { root: RichTextNode & { type: 'root'; children: RichTextNode[] }; [key: string]: unknown }

/**
 * How deep a rich text value may nest, how large it may be and how many nodes it may hold,
 * all checked before any Lexical code reads it.
 */
export const richTextBounds = { depth: 64, bytes: 512 * 1024, nodes: 10_000 }

// Depth is checked before `JSON.stringify` walks a hostile value. An object met
// twice is refused, so one reachable many ways is not walked once per way.
const within = (value: unknown, depth: number, seen = new WeakSet<object>()): string | undefined => {
  if (value === null || typeof value !== 'object') return undefined
  if (depth <= 0) return `The value nests deeper than ${richTextBounds.depth} levels.`
  if (seen.has(value)) return 'The value holds one object in two places.'
  seen.add(value)
  for (const one of Object.values(value)) {
    const refused = within(one, depth - 1, seen)
    if (refused) return refused
  }
  return undefined
}

/** Whether a link may point here: `http`, `https`, `mailto`, `tel`, a fragment or a path. */
export const safeUrl = (url: unknown): boolean => {
  if (typeof url !== 'string') return false
  // eslint-disable-next-line no-control-regex
  const cleaned = url.trim().replace(/[\x00-\x1f\x7f]/g, '')
  if (cleaned.startsWith('#') || cleaned.startsWith('/') || cleaned.startsWith('./') || cleaned.startsWith('../')) return true
  const protocol = cleaned.match(/^([a-z][a-z0-9+\-.]*):(?=.)/i)?.[1]?.toLowerCase()
  // A web address must name a host: refuses `https://`, `http:///path` (read as
  // a host named `path`), `https://@` and the like.
  if (protocol === 'http' || protocol === 'https') {
    try {
      return /^https?:\/\/[^/?#\\\s]/i.test(cleaned) && /[\p{L}\p{N}]/u.test(new URL(cleaned).hostname)
    } catch {
      return false
    }
  }
  return protocol === 'mailto' || protocol === 'tel'
}

const held = (node: object, key: string) => (node as Record<string, unknown>)[key]

/**
 * Why a value is no Lexical editor state a `richText` column may hold, or nothing. Runs before
 * any Lexical code reads the value; a `style` is refused, since no editor of the project writes one.
 */
export const richTextGuard = (value: unknown): string | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'The value is no object.'
  const nested = within(value, richTextBounds.depth)
  if (nested) return nested
  if (new TextEncoder().encode(JSON.stringify(value)).length > richTextBounds.bytes) return `The value is larger than ${richTextBounds.bytes} bytes.`
  const root = held(value, 'root')
  if (!root || typeof root !== 'object' || Array.isArray(root) || held(root, 'type') !== 'root') return 'The value has no root of type "root".'
  if (!Array.isArray(held(root, 'children'))) return 'The root holds no list of children.'
  let count = 0
  const walk = (node: unknown): string | undefined => {
    if (!node || typeof node !== 'object' || Array.isArray(node) || typeof held(node, 'type') !== 'string') return 'A node is no object with a string type.'
    if (++count > richTextBounds.nodes) return `The value holds more than ${richTextBounds.nodes} nodes.`
    const type = held(node, 'type') as string
    if (Object.hasOwn(node, 'text') && typeof held(node, 'text') !== 'string') return `A node of type "${type}" holds text that is no string.`
    if (typeof held(node, 'text') === 'string') {
      for (const key of ['format', 'detail']) {
        if (Object.hasOwn(node, key) && !Number.isInteger(held(node, key))) return `A node of type "${type}" holds a ${key} that is no whole number.`
      }
    }
    for (const key of ['style', 'textStyle']) {
      if (Object.hasOwn(node, key) && held(node, key) !== '') return `A node of type "${type}" holds a ${key}, and this editor writes none.`
    }
    if ((type === 'link' || type === 'autolink') && !safeUrl(held(node, 'url'))) return `A link points at an address that is not http, https, mailto, tel or a path.`
    if (!Object.hasOwn(node, 'children')) return undefined
    const children = held(node, 'children')
    if (!Array.isArray(children)) return `A node of type "${type}" holds children that are no list.`
    for (const child of children) {
      const refused = walk(child)
      if (refused) return refused
    }
    return undefined
  }
  return walk(root)
}

/** Whether a value passes `richTextGuard`, which is all the kind itself asks of one. */
export const isRichText = (value: unknown): value is RichTextValue => richTextGuard(value) === undefined

/**
 * The first node type under a value's `root` that `types` does not hold, or nothing, and `''`
 * past the depth bound. Read off the JSON, since a production Lexical minifies its errors.
 */
export const unknownType = ({ node, types, depth = richTextBounds.depth }: { node: unknown; types: ReadonlySet<string>; depth?: number }): string | undefined => {
  if (!node || typeof node !== 'object') return undefined
  if (depth <= 0) return ''
  const held = node as { type?: unknown; children?: unknown }
  if (typeof held.type === 'string' && !types.has(held.type)) return held.type
  for (const child of Array.isArray(held.children) ? held.children : []) {
    const type = unknownType({ node: child, types, depth: depth - 1 })
    if (type !== undefined) return type
  }
  return undefined
}

/** What a write's value reads as: its text and whether it holds a decorator, or why it is refused. */
export type RichTextRead = { text: string; holdsDecorator?: boolean } | { refused: string; type?: string }

/**
 * How a stored `richText` value is read back: a root with children and nothing more,
 * so a value holding a node the project has since dropped still reads.
 */
export const storedRichText = (value: unknown): RichTextRead => {
  const root = value && typeof value === 'object' && !Array.isArray(value) ? (value as { root?: { type?: unknown; children?: unknown } }).root : undefined
  return root && typeof root === 'object' && root.type === 'root' && Array.isArray(root.children) ? { text: '' } : { refused: 'The stored value is no editor state.' }
}
