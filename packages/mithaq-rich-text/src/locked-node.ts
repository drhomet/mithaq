import { $getDocument, DecoratorNode, type LexicalNode, type NodeKey, type SerializedLexicalNode, type Spread } from 'lexical'
import type { LockedRange } from './runs.ts'

export type SerializedLockedNode = Spread<Pick<LockedRange, 'id' | 'placement' | 'preview'>, SerializedLexicalNode>

/**
 * The stand-in for a subtree the phone cannot edit. It lives only in the editor
 * state: `saveBlock` swaps the original JSON back in, so a stored document never
 * holds this type, its id or a U+FFFC.
 */
export class LockedNode extends DecoratorNode<null> {
  __id: string
  __placement: LockedRange['placement']
  __preview: string

  static getType() { return 'locked-unit' }
  static clone(node: LockedNode) { return new LockedNode({ id: node.__id, placement: node.__placement, preview: node.__preview, key: node.__key }) }
  static importJSON(json: SerializedLockedNode) { return new LockedNode({ id: json.id, placement: json.placement, preview: json.preview }) }

  constructor({ id, placement, preview, key }: Pick<LockedRange, 'id' | 'placement' | 'preview'> & { key?: NodeKey }) {
    super(key)
    this.__id = id
    this.__placement = placement
    this.__preview = preview
  }

  exportJSON(): SerializedLockedNode {
    return { ...super.exportJSON(), type: 'locked-unit', version: 1, id: this.__id, placement: this.__placement, preview: this.__preview }
  }
  // Lexical's own document accessor, so the class names no DOM global on the phone, where nothing draws it.
  createDOM() { return $getDocument().createElement('span') }
  updateDOM() { return false }
  decorate() { return null }
  isInline() { return this.__placement === 'inline' }
  // The preview is what plain text, previews and search see.
  getTextContent() { return this.__preview }
}

export const $createLockedNode = (unit: Pick<LockedRange, 'id' | 'placement' | 'preview'>) => new LockedNode(unit)
export const $isLockedNode = (node: LexicalNode | null | undefined): node is LockedNode => node instanceof LockedNode
