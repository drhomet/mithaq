// Adapted from shadcn-editor's MentionNode and Lexical's playground, MIT; see LICENSES/.
import { $getState, $setState, createState, TextNode, type LexicalUpdateJSON, type SerializedTextNode } from 'lexical'

// State configs are local allocations, so an uninstalled mention feature can be dropped from clients.
const kayan = /* @__PURE__ */ createState('kayan', { parse: (value) => typeof value === 'string' ? value : '' })
const id = /* @__PURE__ */ createState('id', { parse: (value) => typeof value === 'string' ? value : '' })
const name = /* @__PURE__ */ createState('name', { parse: (value) => typeof value === 'string' ? value : '' })
export type Mention = { kayan: string; id: string; name: string }

/** DOM-free record identity; the browser resolves permission before drawing any link. */
export class MentionNode extends TextNode {
  $config() {
    return this.config('mention', { extends: TextNode, stateConfigs: [kayan, id, name].map((stateConfig) => ({ stateConfig, flat: true })) })
  }
  setMention(value: Mention): this {
    $setState($setState($setState(this, kayan, value.kayan), id, value.id), name, value.name)
    return this.setTextContent(`@${value.name}`).setMode('token')
  }
  getMention(): Mention {
    return { kayan: $getState(this, kayan), id: $getState(this, id), name: $getState(this, name) }
  }
  exportJSON() {
    return { ...super.exportJSON(), ...this.getMention() }
  }
  updateFromJSON(value: LexicalUpdateJSON<SerializedTextNode>): this {
    const node = super.updateFromJSON(value)
    const mention = node.getMention()
    if (!mention.kayan || !mention.id || !mention.name || node.getTextContent() !== `@${mention.name}`) throw new Error('A mention requires a record identity and its original name.')
    return node
  }
  isTextEntity(): true { return true }
  canInsertTextBefore(): false { return false }
  canInsertTextAfter(): false { return false }
}
