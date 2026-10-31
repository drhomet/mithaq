import { nodeFeatures, richTextChoiceFeatures, richTextFormatBits, toolFeatureNodes } from './feature-data.ts'

import type { RichTextPolicy } from './policy.ts'

export type Place = 'admin' | 'lynx-viewer' | 'native-android' | 'native-ios'
export type Support = 'edit' | 'view' | 'none'
export type NodeRegistration = {
  type: string
  json: { writes: number; reads: readonly number[] }
  support: Readonly<Record<Place, Support>>
  native?: readonly string[]
}
export type RichTextProfile = {
  name: string
  nodes: readonly string[]
  requirements: Partial<Record<Place, { default: 'edit' | 'view'; nodes?: Readonly<Record<string, 'edit' | 'view'>> }>>
}
export type RichTextDiagnostic = {
  severity: 'warning' | 'error'
  code: 'support-gap' | 'profile-node-unknown' | 'profile-node-unselected' | 'policy-support-gap' | 'native-reference-required' | 'native-reference-unresolved' | 'native-codec-missing'
  profile: string
  node?: string
  feature?: string
  place: Place | null
  required: Support
  available: Support
  remedy: string
}
export const richTextPlaces: readonly Place[] = ['admin', 'lynx-viewer', 'native-android', 'native-ios']
const supportRank = { none: 0, view: 1, edit: 2 }

export type RichTextContract = { formats?: Readonly<Record<string, number>>; paragraphs?: readonly string[] }

const resolves = (reference: string, contract?: RichTextContract): boolean => {
  const parts = reference.split('.')
  const [section, name] = parts
  if (!name || parts.length !== 2) return false
  if (section === 'paragraphs') return contract?.paragraphs?.includes(name) === true
  return section === 'formats' && Object.hasOwn(richTextFormatBits, name) && contract?.formats?.[name] === richTextFormatBits[name as keyof typeof richTextFormatBits]
}

export const checkRichTextSupport = ({ registry, profile, policies = [], contract, codecs = [] }: { registry: readonly NodeRegistration[]; profile: RichTextProfile; policies?: readonly RichTextPolicy[]; contract?: RichTextContract; codecs?: readonly string[] }): RichTextDiagnostic[] => {
  const diagnostics: RichTextDiagnostic[] = []
  for (const node of registry) {
    const references = node.native?.filter((reference) => reference !== 'none') ?? []
    // A stale reference is wrong whatever the node claims, so it belongs to the node rather than to a place.
    if (references.some((reference) => !resolves(reference, contract))) diagnostics.push({ severity: 'error', code: 'native-reference-unresolved', profile: profile.name, node: node.type, place: null, required: 'none', available: 'none', remedy: 'Declare only native references the installed rich-input contract resolves.' })
    for (const place of ['native-android', 'native-ios'] as const) {
      if (node.support[place] !== 'edit') continue
      // References name what rich-input draws; only a codec carrying the whole node makes editing lossless.
      if (!references.length || node.native?.includes('none')) diagnostics.push({ severity: 'error', code: 'native-reference-required', profile: profile.name, node: node.type, place, required: 'edit', available: 'none', remedy: 'Declare only lossless native support with references resolved by the installed rich-input contract.' })
      else if (!codecs.includes(node.type)) diagnostics.push({ severity: 'error', code: 'native-codec-missing', profile: profile.name, node: node.type, place, required: 'edit', available: 'none', remedy: 'Claim native editing only for node types the installed native codec carries.' })
    }
  }
  for (const type of profile.nodes) {
    if (!registry.some((node) => node.type === type)) diagnostics.push({ severity: 'warning', code: 'profile-node-unknown', profile: profile.name, node: type, place: null, required: 'none', available: 'none', remedy: 'Register the selected node or correct its profile type.' })
  }
  for (const place of richTextPlaces) {
    const requirement = profile.requirements[place]
    if (!requirement) continue
    for (const [type, required] of Object.entries(requirement.nodes ?? {})) {
      if (!profile.nodes.includes(type)) diagnostics.push({ severity: 'warning', code: 'profile-node-unselected', profile: profile.name, node: type, place, required, available: 'none', remedy: 'Select this node in the profile or correct the requirement type.' })
    }
    for (const type of profile.nodes) {
      const required = requirement.nodes?.[type] ?? requirement.default
      const node = registry.find((node) => node.type === type)
      const available = node?.support[place] ?? 'none'
      if (node && supportRank[available] < supportRank[required]) diagnostics.push({ severity: 'warning', code: 'support-gap', profile: profile.name, node: type, place, required, available, remedy: 'Install support for this node at this place or revise the profile requirement.' })
    }
    for (const feature of new Set(policies.flatMap((policy) => [...policy.features]))) {
      const mapped = Object.entries(nodeFeatures).filter(([, name]) => name === feature).map(([type]) => type)
      const choices = Object.entries(richTextChoiceFeatures).filter(([, name]) => name === feature).map(([choice]) => choice)
      // Checklists share list classes; derive the association from the existing list policy guard.
      const types = feature === richTextChoiceFeatures.check ? Object.keys(nodeFeatures).filter((type) => nodeFeatures[type] === richTextChoiceFeatures.bullet)
        : mapped.length ? mapped : Object.hasOwn(richTextFormatBits, feature) ? ['text'] : toolFeatureNodes[feature] ?? []
      const selected = types.filter((type) => profile.nodes.includes(type))
      for (const type of selected.length ? selected : types) {
        // A place that only shows a node never runs the editor's tools on it.
        if ((requirement.nodes?.[type] ?? requirement.default) !== 'edit') continue
        const node = profile.nodes.includes(type) ? registry.find((node) => node.type === type) : undefined
        let available = node?.support[place] ?? 'none'
        if (available === 'edit' && place.startsWith('native-')) {
          const references = Object.hasOwn(richTextFormatBits, feature) ? [`formats.${feature}`] : choices.map((choice) => `paragraphs.${choice}`)
          if (!references.length || references.some((reference) => !node?.native?.includes(reference))) available = 'none'
        }
        if (available !== 'edit') diagnostics.push({ severity: 'warning', code: 'policy-support-gap', profile: profile.name, node: type, feature, place, required: 'edit', available, remedy: 'Install editable support for the allowed feature or narrow the field policy at this place.' })
      }
    }
  }
  const unique = [...new Map(diagnostics.map((item) => [JSON.stringify(item), item])).entries()]
  return unique.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, item]) => item)
}

/**
 * The node types the runs codec (`loadBlock`, `saveBlock`) carries as editable runs, the `codecs` input of
 * `checkRichTextSupport`. Every other type opens on the phone as a locked unit. Here, not beside the codec,
 * so the check and its CLI read it without Lexical installed.
 */
export const runsCodecTypes: readonly string[] = ['root', 'paragraph', 'text', 'heading', 'list', 'listitem', 'quote', 'horizontalrule', 'upload']

// Native codecs and Lynx renderers have not been proven against these complete node shapes.
// Contract entries for a subset of text formats, heading tags or flat lists cannot establish edit support.
export const defaultNodeRegistry: readonly NodeRegistration[] = [
  { type: 'root', json: { writes: 1, reads: [1] }, support: { admin: 'edit', 'lynx-viewer': 'none', 'native-android': 'none', 'native-ios': 'none' } },
  { type: 'paragraph', json: { writes: 1, reads: [1] }, support: { admin: 'edit', 'lynx-viewer': 'none', 'native-android': 'none', 'native-ios': 'none' } },
  { type: 'text', json: { writes: 1, reads: [1] }, support: { admin: 'edit', 'lynx-viewer': 'none', 'native-android': 'none', 'native-ios': 'none' } },
  { type: 'linebreak', json: { writes: 1, reads: [1] }, support: { admin: 'edit', 'lynx-viewer': 'none', 'native-android': 'none', 'native-ios': 'none' } },
  { type: 'tab', json: { writes: 1, reads: [1] }, support: { admin: 'edit', 'lynx-viewer': 'none', 'native-android': 'none', 'native-ios': 'none' } },
  { type: 'heading', json: { writes: 1, reads: [1] }, support: { admin: 'edit', 'lynx-viewer': 'none', 'native-android': 'none', 'native-ios': 'none' } },
  { type: 'quote', json: { writes: 1, reads: [1] }, support: { admin: 'edit', 'lynx-viewer': 'none', 'native-android': 'none', 'native-ios': 'none' } },
  { type: 'list', json: { writes: 1, reads: [1] }, support: { admin: 'edit', 'lynx-viewer': 'none', 'native-android': 'none', 'native-ios': 'none' } },
  { type: 'listitem', json: { writes: 1, reads: [1] }, support: { admin: 'edit', 'lynx-viewer': 'none', 'native-android': 'none', 'native-ios': 'none' } },
  { type: 'link', json: { writes: 1, reads: [1] }, support: { admin: 'edit', 'lynx-viewer': 'none', 'native-android': 'none', 'native-ios': 'none' } },
  { type: 'autolink', json: { writes: 1, reads: [1] }, support: { admin: 'edit', 'lynx-viewer': 'none', 'native-android': 'none', 'native-ios': 'none' } },
  { type: 'horizontalrule', json: { writes: 1, reads: [1] }, support: { admin: 'edit', 'lynx-viewer': 'none', 'native-android': 'none', 'native-ios': 'none' } },
  { type: 'table', json: { writes: 1, reads: [1] }, support: { admin: 'edit', 'lynx-viewer': 'none', 'native-android': 'none', 'native-ios': 'none' } },
  { type: 'tablerow', json: { writes: 1, reads: [1] }, support: { admin: 'edit', 'lynx-viewer': 'none', 'native-android': 'none', 'native-ios': 'none' } },
  { type: 'tablecell', json: { writes: 1, reads: [1] }, support: { admin: 'edit', 'lynx-viewer': 'none', 'native-android': 'none', 'native-ios': 'none' } },
  { type: 'code', json: { writes: 1, reads: [1] }, support: { admin: 'edit', 'lynx-viewer': 'none', 'native-android': 'none', 'native-ios': 'none' } },
  { type: 'code-highlight', json: { writes: 1, reads: [1] }, support: { admin: 'edit', 'lynx-viewer': 'none', 'native-android': 'none', 'native-ios': 'none' } },
  { type: 'mark', json: { writes: 1, reads: [1] }, support: { admin: 'edit', 'lynx-viewer': 'none', 'native-android': 'none', 'native-ios': 'none' } },
  { type: 'hashtag', json: { writes: 1, reads: [1] }, support: { admin: 'edit', 'lynx-viewer': 'none', 'native-android': 'none', 'native-ios': 'none' } },
  { type: 'mention', json: { writes: 1, reads: [1] }, support: { admin: 'edit', 'lynx-viewer': 'none', 'native-android': 'none', 'native-ios': 'none' } },
  { type: 'upload', json: { writes: 3, reads: [1, 2, 3] }, support: { admin: 'edit', 'lynx-viewer': 'none', 'native-android': 'none', 'native-ios': 'none' } },
]
