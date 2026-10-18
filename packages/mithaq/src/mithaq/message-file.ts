/** A translated leaf, an opaque resolver result, or a function's unverifiable marker. */
export type MessageEntry = Record<string, string> | string | null

type Branch = { [key: string]: MessageEntry | Branch }
const branch = (value: unknown): value is Branch => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Reads both release formats, keeping a parent's own value separate from its children. */
export const flattenMessageFile = ({ file, locales }: { file: Record<string, unknown>; locales: readonly string[] }): Record<string, MessageEntry> => {
  const entries: [string, MessageEntry][] = []
  const walk = (node: Record<string, unknown>, parts: string[]) => {
    for (const [name, value] of Object.entries(node)) {
      const path = [...parts, name]
      if (name === '$value') entries.push([parts.join('.'), value as MessageEntry])
      else if (branch(value) && !(Object.values(value).every((one) => typeof one === 'string') && (!Object.keys(value).length || Object.keys(value).some((key) => locales.includes(key))))) walk(value, path)
      else entries.push([path.join('.'), value as MessageEntry])
    }
  }
  walk(file, [])
  return Object.fromEntries(entries)
}

/** A value gets `$value` only when another key needs to pass through it. */
export const nestMessageFile = (entries: Record<string, MessageEntry>): Branch => {
  const result: Branch = Object.create(null)
  const keys = Object.keys(entries).sort()
  for (const key of keys) {
    const parts = [...key.split('.'), ...(keys.some((other) => other.startsWith(`${key}.`)) ? ['$value'] : [])]
    const last = parts.pop()!
    parts.reduce((node, part) => (node[part] ??= Object.create(null)) as Branch, result)[last] = entries[key]!
  }
  return result
}
