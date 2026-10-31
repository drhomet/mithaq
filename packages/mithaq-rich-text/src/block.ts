// Stored Lexical JSON ↔ runs for one Block, with locked units.
//
// A subtree the phone cannot express as runs is never handed to a node class, which
// could normalize it. It is parked in a LockedTable, keyed by a session id, and a
// LockedNode stands in for it. `saveBlock` swaps the original JSON back in, so a
// stored document never holds a placeholder, an id or a U+FFFC.
//
// A subtree is expressible only if it survives JSON → runs → JSON, apart from
// typing state on a paragraph, heading or list item and lossless joins of identical adjacent text nodes. That
// one test covers unknown types, unknown versions, unknown metadata, formats and
// styles outside the five, nested lists, tables and anything Lexical adds later.
import type { SerializedLexicalNode } from 'lexical'
import { defaultNodes } from './rich-text.ts'
import { createRunsEditor, nodesToRuns, runsToNodes } from './codec.ts'
import { validateRuns, type LockedRange, type Runs } from './runs.ts'
import type { LexicalEditor } from 'lexical'

type Json = SerializedLexicalNode & Record<string, unknown> & { children?: Json[] }

/** The original JSON of every unit in a session, by id. It never leaves JS. */
export class LockedTable {
  readonly units = new Map<string, Json>()
  /** The Block's children as `loadBlock` opened them, for the typing state of hosts the phone did not touch. */
  opened: readonly Json[] = []
  #next = 1
  add(json: Json): string {
    const id = `u${this.#next++}`
    this.units.set(id, json)
    return id
  }
}

const NODE_TYPES = new Set(['root', 'paragraph', 'text', 'linebreak', 'tab', ...defaultNodes.map((node) => node.getType())])
// Inline containers and leaves that may sit in a paragraph. An unregistered type in
// a paragraph is treated the same way: it cannot be a block, so it is an inline unit.
const INLINE_TYPES = new Set(['link', 'autolink', 'linebreak', 'tab'])
const TEXT_HOSTS = new Set(['paragraph', 'heading', 'listitem'])

const root = (children: Json[]) => ({ root: { type: 'root', version: 1, direction: null, format: '', indent: 0, children } })

const joinText = (nodes: unknown[]) => nodes.reduce<unknown[]>((out, value) => {
  const previous = out.at(-1) as Json | undefined
  const node = value as Json | null
  if (node?.type === 'text' && previous?.type === 'text' && node.mode === 'normal' && typeof node.text === 'string' && typeof previous.text === 'string'
    && JSON.stringify({ ...previous, text: '' }) === JSON.stringify({ ...node, text: '' })) out[out.length - 1] = { ...previous, text: previous.text + node.text }
  else out.push(value)
  return out
}, [])

/** Only the caret's typing state on a text host and identical adjacent text boundaries may change. */
const comparable = (json: unknown): unknown =>
  Array.isArray(json) ? joinText(json.map(comparable))
  : json && typeof json === 'object'
    ? Object.fromEntries(Object.entries(json).filter(([key]) => !TEXT_HOSTS.has((json as { type?: string }).type ?? '') || (key !== 'textFormat' && key !== 'textStyle')).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, comparable(v)]))
    : json
const same = (a: unknown, b: unknown) => JSON.stringify(comparable(a)) === JSON.stringify(comparable(b))

const previewOf = (json: Json): string => {
  if (json.type === 'linebreak') return '\n'
  if (json.type === 'tab') return ' '
  const words: string[] = []
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return
    const { text, children } = node as { text?: unknown; children?: unknown }
    if (typeof text === 'string') words.push(text)
    if (Array.isArray(children)) children.forEach(walk)
  }
  walk(json)
  // ponytail: one generic label; a localized one and a ChecklistNode renderer come with the adopting app.
  return words.join(' ').replace(/[\n￼\s]+/g, ' ').trim().slice(0, 80) || 'Locked content'
}

const scratch = createRunsEditor()
const survives = (node: Json): boolean => {
  if (!NODE_TYPES.has(node.type)) return false
  try {
    scratch.setEditorState(scratch.parseEditorState(root([node])))
    runsToNodes(scratch, nodesToRuns(scratch))
    return same(scratch.getEditorState().toJSON().root.children, [node])
  } catch {
    return false
  }
}

const isInlineUnit = (child: Json) =>
  child.type === 'text' ? typeof child.text === 'string' && /[\n￼]/.test(child.text) : INLINE_TYPES.has(child.type) || !NODE_TYPES.has(child.type)

const placeholder = ({ placement, id, json }: { placement: LockedRange['placement']; id: string; json: Json }) => ({ type: 'locked-unit', version: 1, id, placement, preview: previewOf(json) }) as unknown as Json

/** Opens a Block's children as runs. Each unit gets the next id in `table`. */
export const loadBlock = ({ editor, children, table }: { editor: LexicalEditor; children: readonly Json[]; table: LockedTable }): Runs => {
  table.opened = children
  const kept: Json[] = []
  let previousList: unknown
  for (const node of children) {
    const inlineUnits: Json[] = []
    const swap = (host: Json): Json =>
      host.type === 'list' ? { ...host, children: host.children?.map(swap) }
      : TEXT_HOSTS.has(host.type) && Array.isArray(host.children)
        ? { ...host, children: host.children.map((child) => (isInlineUnit(child) ? placeholder({ placement: 'inline', id: `~${inlineUnits.push(child) - 1}`, json: child }) : child)) }
        : host
    const candidate = swap(node)
    // Two touching lists of one kind would become one list on save, so the later one stays a unit.
    const listKind = node.type === 'list' ? node.listType : undefined
    if (survives(candidate) && !(listKind && listKind === previousList)) {
      kept.push(JSON.parse(JSON.stringify(candidate), (key, value) => (key === 'id' && typeof value === 'string' && value.startsWith('~') ? table.add(inlineUnits[Number(value.slice(1))]!) : value)))
      previousList = listKind
    } else {
      kept.push(placeholder({ placement: 'paragraph', id: table.add(node), json: node }))
      previousList = undefined
    }
  }
  editor.setEditorState(editor.parseEditorState(root(kept)))
  return validateRuns(nodesToRuns(editor))
}

/** The Block's children as stored JSON: original subtrees back in, no placeholder left. */
export const saveBlock = (editor: LexicalEditor, table: LockedTable): Json[] => {
  const used = new Set<string>()
  const restore = (node: Json): Json => {
    if (node.type !== 'locked-unit') return node.children ? { ...node, children: node.children.map(restore) } : node
    const id = node.id as string
    const original = table.units.get(id)
    if (!original || used.has(id)) throw new Error(`Locked unit ${id} is missing or repeated`)
    used.add(id)
    // JSON in, JSON out: PrimJS has no structuredClone.
    return JSON.parse(JSON.stringify(original)) as Json
  }
  // As stored: keys Lexical leaves undefined are absent, as they are after any database round trip.
  const saved = (JSON.parse(JSON.stringify(editor.getEditorState().toJSON().root.children)) as Json[]).map(restore)
  if (used.size !== table.units.size) throw new Error('A locked unit was lost')
  // Lexical writes typing state only on empty hosts, so an untouched host gets its stored keys back.
  // ponytail: hosts match from both ends, so only one edited stretch per save keeps the rest; an LCS if edits scatter.
  const before = hostsOf(table.opened)
  const after = hostsOf(saved)
  const keep = (from: Json, to: Json) => {
    if (!same(from, to)) return false
    for (const key of ['textFormat', 'textStyle']) if (key in from) to[key] = from[key]; else delete to[key]
    return true
  }
  let head = 0
  while (head < Math.min(before.length, after.length) && keep(before[head]!, after[head]!)) head++
  for (let tail = 1; tail <= Math.min(before.length, after.length) - head && keep(before.at(-tail)!, after.at(-tail)!); tail++);
  return saved
}

const hostsOf = (nodes: readonly Json[]): Json[] => nodes.flatMap((node) => (node.type === 'list' ? hostsOf(node.children ?? []) : TEXT_HOSTS.has(node.type) ? [node] : []))
