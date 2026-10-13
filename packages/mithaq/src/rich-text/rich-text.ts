// No React and no DOM: the server checks a write with the same node list the browser draws with.
import { HorizontalRuleNode } from '@lexical/extension'
import { LinkNode } from '@lexical/link'
import { ListItemNode, ListNode } from '@lexical/list'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import {
  $getDocument,
  $getRoot,
  $isDecoratorNode,
  $isElementNode,
  $getState,
  $setState,
  createEditor,
  createState,
  DecoratorNode,
  LineBreakNode,
  ParagraphNode,
  RootNode,
  TabNode,
  TextNode,
  type ElementFormatType,
  type Klass,
  type LexicalNode,
  type LexicalUpdateJSON,
  type SerializedEditorState,
  type SerializedLexicalNode,
} from 'lexical'
import { richTextBounds, richTextGuard, safeUrl, unknownType, type RichTextRead, type RichTextValue } from './value.ts'

export * from './value.ts'

/** The node classes the registry's editor draws. A project's list spreads it: `[...defaultNodes, CalloutNode]`. */
export const defaultNodes: readonly Klass<LexicalNode>[] = [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, HorizontalRuleNode]

/** The nodes every Lexical editor registers whatever it is given. */
const coreNodes: readonly Klass<LexicalNode>[] = [RootNode, ParagraphNode, TextNode, LineBreakNode, TabNode]

/** Every node type a list of classes can read, the core ones included. */
export const typesOf = (nodes: readonly Klass<LexicalNode>[]): ReadonlySet<string> => new Set([...coreNodes, ...nodes].map((node) => node.getType()))

// Set by `richTextReader` around its own synchronous parse alone, so a value is
// never checked against another build's list.
let holdingFiles: ReadonlySet<string> | undefined

const formats: readonly ElementFormatType[] = ['', 'left', 'start', 'center', 'right', 'end', 'justify']
const formatState = createState('format', { parse: (value): ElementFormatType => (formats.includes(value as ElementFormatType) ? (value as ElementFormatType) : '') })
// The node's own id, not the file's: an ObjectID's hex.
const uploadIdState = createState('id', { parse: (value) => (typeof value === 'string' ? value : '') })
const relationToState = createState('relationTo', {
  parse: (value) => {
    if (value === undefined) return ''
    if (typeof value !== 'string' || !value) throw new Error('An upload names the kayan its file is a row of, as a string under relationTo.')
    if (holdingFiles && !holdingFiles.has(value)) throw new Error(`An upload's relationTo "${value}" is no kayan of this build that holds files.`)
    return value
  },
})
const valueState = createState('value', {
  parse: (value) => {
    if (value === undefined) return ''
    if (typeof value !== 'string' || !value || value.length > 255) throw new Error("An upload's value is the id of its file's row, a string.")
    return value
  },
})
/** The extra fields Payload's editor asks of an upload, such as a caption, kept as they were written and drawn by nothing here. */
const fieldsState = createState('fields', { parse: (value) => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null) })

/** An upload node as Payload's lexical editor writes it, v3. */
export type SerializedUploadNode = SerializedLexicalNode & {
  type: 'upload'
  version: 3
  format: ElementFormatType
  id: string
  relationTo: string
  value: string
  fields: Record<string, unknown> | null
}

/**
 * A file inside rich text, in the JSON Payload's editor writes (`type: 'upload'`, `version: 3`).
 * DOM-free, so the server checks a write with it. A project opts in: `[...defaultNodes, UploadNode]`.
 */
export class UploadNode extends DecoratorNode<unknown> {
  $config() {
    return this.config('upload', {
      extends: DecoratorNode,
      stateConfigs: [
        { stateConfig: formatState, flat: true },
        { stateConfig: uploadIdState, flat: true },
        { stateConfig: relationToState, flat: true },
        { stateConfig: valueState, flat: true },
        { stateConfig: fieldsState, flat: true },
      ],
    })
  }

  /** Refused where either half of what the node points at is missing, which an absent key leaves at its default. */
  updateFromJSON(json: LexicalUpdateJSON<SerializedLexicalNode>): this {
    const node = super.updateFromJSON(json)
    if (!$getState(node, relationToState) || !$getState(node, valueState)) throw new Error('An upload names its relationTo and its value.')
    return node
  }

  /** Every key, defaults included, as Payload's editor writes it. */
  exportJSON(): SerializedUploadNode {
    return {
      ...super.exportJSON(),
      type: 'upload',
      version: 3,
      format: $getState(this, formatState),
      id: $getState(this, uploadIdState),
      relationTo: $getState(this, relationToState),
      value: $getState(this, valueState),
      fields: $getState(this, fieldsState),
    }
  }

  getRelationTo(): string {
    return $getState(this, relationToState)
  }

  getValue(): string {
    return $getState(this, valueState)
  }

  getFormat(): ElementFormatType {
    return $getState(this, formatState)
  }

  /** Points the node at one file, with a fresh node id: an ObjectID's twelve bytes in hex. */
  setUpload(relationTo: string, value: string): this {
    const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => byte.toString(16).padStart(2, '0')).join('')
    return $setState($setState($setState(this, uploadIdState, id), relationToState, relationTo), valueState, value)
  }

  createDOM(): HTMLElement {
    return $getDocument().createElement('div')
  }

  updateDOM(): false {
    return false
  }

  isInline(): false {
    return false
  }

  decorate(): unknown {
    return null
  }
}

/** Whether a node is a decorator or holds one at any depth. */
const $holdsDecorator = (node: LexicalNode): boolean => $isDecoratorNode(node) || ($isElementNode(node) && node.getChildren().some($holdsDecorator))

/**
 * A reader of `richText` values over a node list: the guard walk, then a headless parse.
 * `uploads` names the kayan an `UploadNode` may point at.
 */
export const richTextReader = (nodes: readonly Klass<LexicalNode>[], uploads?: readonly string[]) => {
  const types = typesOf(nodes)
  const holding = uploads && new Set(uploads)
  // Made with the reader at `buildAsas`, so a list Lexical cannot register fails
  // the build rather than the first write.
  const editor = createEditor({ nodes: [...nodes], onError: (error) => { throw error } })
  return (value: unknown): RichTextRead => {
    const refused = richTextGuard(value)
    if (refused) return { refused }
    const type = unknownType({ node: (value as { root: unknown }).root, types })
    if (type) {
      return {
        refused: `No node of this editor is of type "${type}". Add its class to the nodes passed to richText({ nodes }), or convert or remove the node before writing.`,
        type,
      }
    }
    // Restored rather than cleared, so a nested parse never leaves the outer one without its list.
    const before = holdingFiles
    try {
      holdingFiles = holding
      return editor.parseEditorState(value as SerializedEditorState).read(() => ({ text: $getRoot().getTextContent(), holdsDecorator: $holdsDecorator($getRoot()) }))
    } catch (error) {
      return { refused: `The editor could not read the value: ${error instanceof Error ? error.message : String(error)}` }
    } finally {
      holdingFiles = before
    }
  }
}

/** What a converter left out of a value: the node's path in what it was handed, its type, and why. */
export type RichTextDropped = { path: string; type: string; reason: string }

/** A converted value, which the guard and the parse of the same node list take, with what was left out of it, or why there is none. */
export type RichTextConverted = { value: RichTextValue; dropped: RichTextDropped[] } | { refused: string }

// Canonical through Lexical's own `toJSON`, so converting again changes nothing,
// and read once more, since the canonical value is larger.
const settle = (convert: () => { value: unknown; dropped: RichTextDropped[] }, nodes: readonly Klass<LexicalNode>[]): RichTextConverted => {
  if (!Array.isArray(nodes)) return { refused: 'The converters were handed no "nodes", and pick none of their own. Pass the project\'s list: nodes: [...defaultNodes, ...].' }
  try {
    const { value, dropped } = convert()
    const reader = richTextReader(nodes)
    const before = reader(value)
    if ('refused' in before) return { refused: before.refused }
    const editor = createEditor({ nodes: [...nodes], onError: (error) => { throw error } })
    // Lexical writes every default key, so a value inside the bounds can grow past them.
    const canonical = JSON.parse(JSON.stringify(editor.parseEditorState(value as SerializedEditorState).toJSON())) as RichTextValue
    const after = reader(canonical)
    return 'refused' in after ? { refused: after.refused } : { value: canonical, dropped }
  } catch (error) {
    return { refused: `The value could not be converted: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/** Payload's own node types, which no class of `defaultNodes` reads: kept where the project's list registers one, dropped where it does not. */
const payloadTypes = new Set(['upload', 'relationship', 'block', 'inlineBlock'])

/**
 * A value Payload's lexical editor stored, as one this editor reads, with what could not come across.
 * A link the editor would not write is replaced by its text; a `style` is cleared.
 */
export const convertPayloadToLexical = ({ data, nodes }: { data: unknown; nodes: readonly Klass<LexicalNode>[] }): RichTextConverted =>
  settle(() => {
    const types = typesOf(nodes)
    const dropped: RichTextDropped[] = []
    // Bounded like `unknownType`; a node met twice is refused, so one reachable many
    // ways is never walked once for each way.
    const seen = new WeakSet<object>()
    const walk = (node: unknown, path: string, depth: number): unknown[] => {
      if (!node || typeof node !== 'object' || Array.isArray(node) || depth <= 0) return [node]
      if (seen.has(node)) throw new Error(`The value holds the node at ${path} in two places.`)
      seen.add(node)
      const next: Record<string, unknown> = { ...node }
      const type = String(next.type)
      const drop = (reason: string) => dropped.push({ path, type, reason })
      // Only a string is quoted in a reason: anything else may be too large or deep to write out.
      const quote = (value: unknown) => (typeof value === 'string' ? JSON.stringify(value) : 'a value that is not a string')
      if (payloadTypes.has(type) && !types.has(type)) {
        drop(`No node of this editor is of type "${type}", so it was left out.`)
        return []
      }
      for (const key of ['style', 'textStyle']) {
        if (Object.hasOwn(next, key) && next[key] !== '') {
          drop(`Its ${key}, ${quote(next[key])}, was cleared, since this editor writes none.`)
          next[key] = ''
        }
      }
      if (Array.isArray(next.children)) next.children = next.children.flatMap((child, index) => walk(child, `${path}.children[${index}]`, depth - 1))
      // Payload's postgres adapter writes a numeric id where a collection's ids are serial.
      if (type === 'upload' && typeof next.value === 'number' && Number.isFinite(next.value)) next.value = String(next.value)
      if (type !== 'link' && type !== 'autolink') return [next]
      const { fields, id: _id, ...link } = next
      const held = fields && typeof fields === 'object' ? (fields as Record<string, unknown>) : undefined
      let url = held ? held.url : link.url
      // Lexical's own autolink marks one its writer unlinked.
      if (next.isUnlinked === true) {
        drop('It was an autolink its writer had unlinked, so only its text was kept.')
        return (next.children as unknown[] | undefined) ?? []
      }
      if (held?.linkType === 'internal' || (held?.doc && !url)) {
        drop('It linked to a Payload document, which this editor has no link for, so only its text was kept.')
        return (next.children as unknown[] | undefined) ?? []
      }
      if (typeof url === 'string' && url.startsWith('www.')) url = `https://${url}`
      if (!safeUrl(url)) {
        drop(`Its address is ${quote(url)}, not http, https, mailto, tel or a path, so only its text was kept.`)
        return (next.children as unknown[] | undefined) ?? []
      }
      // `noopener`, so the page a new tab opens cannot reach this one.
      const blank = held?.newTab === true
      const tab = held ? { target: blank ? '_blank' : null, rel: blank ? 'noopener' : null } : {}
      return [{ ...link, type: 'link', url, ...tab }]
    }
    return { value: { root: walk((data as { root?: unknown } | null)?.root, 'root', richTextBounds.depth)[0] }, dropped }
  }, nodes)

/** Plain text as a value: a blank line starts a paragraph, a newline is a `linebreak` and a tab a `tab`. */
export const convertPlaintextToLexical = ({ text, nodes }: { text: string; nodes: readonly Klass<LexicalNode>[] }): RichTextConverted =>
  settle(() => ({
    value: {
      root: {
        type: 'root',
        children: text
          .replace(/\r\n?/g, '\n')
          .split('\n\n')
          .map((paragraph) => ({
            type: 'paragraph',
            children: paragraph
              .split(/(\n|\t)/)
              .filter(Boolean)
              .map((part) => (part === '\n' ? { type: 'linebreak' } : part === '\t' ? { type: 'tab', text: '\t' } : { type: 'text', text: part })),
          })),
      },
    },
    dropped: [],
  }), nodes)
