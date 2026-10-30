import { richTextFormatBits } from './feature-data.ts'

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
  code: string
  profile: string
  node?: string
  feature?: string
  place: Place
  required: Support
  available: Support
  remedy: string
}
export const richTextPlaces: readonly Place[] = ['admin', 'lynx-viewer', 'native-android', 'native-ios']
const supportRank = { none: 0, view: 1, edit: 2 }

export type RichTextContract = { formats?: Readonly<Record<string, number>>; paragraphs?: readonly string[] }

const resolves = (reference: string, contract?: RichTextContract): boolean => {
  const [section, name, extra] = reference.split('.')
  if (!name || extra) return false
  if (section === 'paragraphs') return contract?.paragraphs?.includes(name) === true
  return section === 'formats' && Object.hasOwn(richTextFormatBits, name) && contract?.formats?.[name] === richTextFormatBits[name as keyof typeof richTextFormatBits]
}

export const checkRichTextSupport = ({ registry, profile, contract }: { registry: readonly NodeRegistration[]; profile: RichTextProfile; contract?: RichTextContract }): RichTextDiagnostic[] => {
  const diagnostics: RichTextDiagnostic[] = []
  for (const node of registry) {
    for (const place of ['native-android', 'native-ios'] as const) {
      const references = node.native?.filter((reference) => reference !== 'none') ?? []
      const missing = node.support[place] === 'edit' && (!references.length || node.native?.includes('none'))
      const unresolved = references.some((reference) => !resolves(reference, contract)) && (node.support[place] !== 'none' || (place === 'native-android' && node.support['native-ios'] === 'none'))
      if (missing || unresolved) diagnostics.push({ severity: 'error', code: missing ? 'native-reference-required' : 'native-reference-unresolved', profile: profile.name, node: node.type, place, required: node.support[place], available: 'none', remedy: 'Declare only lossless native support with references resolved by the installed rich-input contract.' })
    }
  }
  for (const place of richTextPlaces) {
    const requirement = profile.requirements[place]
    if (!requirement) continue
    for (const type of profile.nodes) {
      const required = requirement.nodes?.[type] ?? requirement.default
      const available = registry.find((node) => node.type === type)?.support[place] ?? 'none'
      if (supportRank[available] < supportRank[required]) diagnostics.push({ severity: 'warning', code: 'support-gap', profile: profile.name, node: type, place, required, available, remedy: 'Install support for this node at this place or revise the profile requirement.' })
    }
  }
  return diagnostics.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}

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
