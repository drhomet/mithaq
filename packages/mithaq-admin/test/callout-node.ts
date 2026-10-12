import { $getDocument, $getState, createState, ElementNode, type EditorConfig } from 'lexical'

// Registered by a test to show the walk checks a link's address before Lexical does.
export { AutoLinkNode } from '@lexical/link'

export const toneState = createState('tone', {
  parse: (value) => {
    if (value === undefined) return 'info'
    if (value === 'info' || value === 'warning') return value
    throw new Error(`A callout's tone is info or warning, never ${JSON.stringify(value)}.`)
  },
})

export class CalloutNode extends ElementNode {
  $config() {
    return this.config('callout', { extends: ElementNode, stateConfigs: [{ stateConfig: toneState, flat: true }] })
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const element = $getDocument().createElement('aside')
    element.setAttribute('data-callout', $getState(this, toneState))
    return element
  }

  updateDOM(): boolean {
    return false
  }
}

